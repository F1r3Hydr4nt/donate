// Builds dist/paper-wallet/ (a single self-contained index.html + licences) and zips it.
import { build as esbuild } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUNTIME_DEPS = ['@noble/curves', '@noble/hashes', '@scure/base', '@scure/bip39', '@paulmillr/qr'];
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function zip(dir, name, outFile) {
  if (process.platform === 'win32') {
    // bsdtar ships with Windows 10+ and writes zip archives with -a.
    execFileSync(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', outFile, name], { cwd: dir });
  } else {
    execFileSync('zip', ['-r', '-X', outFile, name], { cwd: dir });
  }
}

// Everything goes inside index.html. Tails serves a file opened with Ctrl+O through
// a portal that exposes only that one file, so sibling app.js/style.css can't load.
// The CSP admits the inline script by its hash and nothing else.
function inlinePage(js, css) {
  if (/<\/script|<!--/i.test(js)) throw new Error('bundle contains </script or <!--, which would break the inline script');
  if (/<\/style/i.test(css)) throw new Error('style.css contains </style');
  const slots = {
    APP_JS_SHA256: createHash('sha256').update(js, 'utf8').digest('base64'),
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { zipPath, zipHash } = await build();
  console.log(`Built ${zipPath}\nSHA-256 ${zipHash}`);
  if (!existsSync(zipPath)) process.exit(1);
}
