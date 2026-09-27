// Builds dist/paper-wallet/ (a single self-contained index.html + licences) and zips it.
import { build as esbuild } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { crc32, deflateRawSync } from 'node:zlib';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DEPS = ['@noble/curves', '@noble/hashes', '@scure/base', '@scure/bip39', '@paulmillr/qr'];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

// The zip is written here rather than by tar/zip so every build of the same commit
// is byte-identical: fixed entry order, one pinned timestamp, no extra fields.
// The timestamp is SOURCE_DATE_EPOCH if set, else the last commit's time.
function sourceDate() {
  const fromEnv = Number(process.env.SOURCE_DATE_EPOCH);
  if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
  try {
    return Number(execFileSync('git', ['log', '-1', '--format=%ct'], { cwd: root, encoding: 'utf8' }).trim());
  } catch {
    return Date.UTC(2026, 0, 1) / 1000;
  }
}

function dosDateTime(epochSeconds) {
  const d = new Date(epochSeconds * 1000);
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((d.getUTCFullYear() - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

function zip(dir, name, outFile) {
  const { time, date } = dosDateTime(sourceDate());
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const file of readdirSync(join(dir, name)).sort()) {
    const data = readFileSync(join(dir, name, file));
    const packed = deflateRawSync(data, { level: 9 });
    const path = Buffer.from(`${name}/${file}`, 'utf8');
    // Fields shared by the local and central headers, from "version needed" to "extra length".
    const common = Buffer.alloc(26);
    common.writeUInt16LE(20, 0); // version needed: 2.0 (deflate)
    common.writeUInt16LE(0x0800, 2); // flags: names are UTF-8
    common.writeUInt16LE(8, 4); // method: deflate
    common.writeUInt16LE(time, 6);
    common.writeUInt16LE(date, 8);
    common.writeUInt32LE(crc32(data), 10);
    common.writeUInt32LE(packed.length, 14);
    common.writeUInt32LE(data.length, 18);
    common.writeUInt16LE(path.length, 22);
    common.writeUInt16LE(0, 24); // no extra field
    const local = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), common, path, packed]);
    const tail = Buffer.alloc(14); // comment length, disk, attributes: all zero, then offset
    tail.writeUInt32LE(offset, 10);
    centrals.push(Buffer.concat([Buffer.from([0x50, 0x4b, 0x01, 0x02, 20, 0]), common, tail, path]));
    locals.push(local);
    offset += local.length;
  }
  const central = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(centrals.length, 8);
  end.writeUInt16LE(centrals.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  writeFileSync(outFile, Buffer.concat([...locals, central, end]));
}

// Everything goes inside index.html. Tails serves a file opened with Ctrl+O through
// a portal that exposes only that one file, so sibling app.js/style.css can't load.
// The CSP admits the inline script and stylesheet by their hashes and nothing else.
function inlinePage(js, css) {
  if (/<\/script|<!--/i.test(js)) throw new Error('bundle contains </script or <!--, which would break the inline script');
  if (/<\/style/i.test(css)) throw new Error('style.css contains </style');
  const cspHash = (text) => createHash('sha256').update(text, 'utf8').digest('base64');
  const slots = {
    APP_JS_SHA256: cspHash(js),
    STYLE_CSS_SHA256: cspHash(css),
    STYLE_CSS: css,
    APP_JS: js,
  };
  let html = readFileSync(join(root, 'web', 'index.html'), 'utf8');
  for (const [name, value] of Object.entries(slots)) {
    const marker = `{{${name}}}`;
    if (html.split(marker).length !== 2) throw new Error(`index.html must contain ${marker} exactly once`);
    html = html.replace(marker, () => value);
  }
  return html;
}

export async function build({ outDir = join(root, 'dist') } = {}) {
  const appDir = join(outDir, 'paper-wallet');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(appDir, { recursive: true });

  const { outputFiles } = await esbuild({
    absWorkingDir: root,
    entryPoints: ['src/main.js'],
    bundle: true,
    format: 'iife', // classic script: module scripts are blocked on file:// in Chromium
    target: ['es2020'],
    platform: 'browser',
    minify: false, // keep the bundle readable for anyone auditing it offline
    legalComments: 'inline',
    charset: 'utf8',
    outfile: 'app.js',
    write: false,
    logLevel: 'warning',
  });
  writeFileSync(join(appDir, 'index.html'), inlinePage(outputFiles[0].text, readFileSync(join(root, 'web', 'style.css'), 'utf8')));

  const licences = RUNTIME_DEPS.map((dep) => {
    const dir = join(root, 'node_modules', dep);
    const { version } = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    const file = readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
    return `==== ${dep}@${version} ====\n${file ? readFileSync(join(dir, file), 'utf8').trim() : '(no licence file)'}\n`;
  });
  writeFileSync(join(appDir, 'THIRD_PARTY_LICENSES.txt'), licences.join('\n'));

  const files = readdirSync(appDir).sort();
  writeFileSync(join(appDir, 'SHA256SUMS.txt'),
    files.map((f) => `${sha256(readFileSync(join(appDir, f)))}  ${f}`).join('\n') + '\n');

  const zipPath = join(outDir, 'paper-wallet.zip');
  zip(outDir, 'paper-wallet', zipPath);
  const zipHash = sha256(readFileSync(zipPath));
  writeFileSync(`${zipPath}.sha256`, `${zipHash}  paper-wallet.zip\n`);
  return { appDir, zipPath, zipHash };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { zipPath, zipHash } = await build();
  console.log(`Built ${zipPath}\nSHA-256 ${zipHash}`);
  if (!existsSync(zipPath)) process.exit(1);
}
