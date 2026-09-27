import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { build } from '../scripts/build.mjs';

let out;
before(async () => {
  out = await build({ outDir: mkdtempSync(join(tmpdir(), 'pw-build-')) });
});

test('bundle contains exactly the offline files', () => {
  assert.deepEqual(readdirSync(out.appDir).sort(),
    ['SHA256SUMS.txt', 'THIRD_PARTY_LICENSES.txt', 'app.js', 'index.html', 'style.css']);
  assert.ok(existsSync(out.zipPath));
});

test('index.html only references local files relative to itself', () => {
  const html = readFileSync(join(out.appDir, 'index.html'), 'utf8');
  const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(refs.sort(), ['app.js', 'style.css']);
  for (const r of refs) assert.ok(existsSync(join(out.appDir, r)));
  assert.doesNotMatch(html, /type="module"/);
});

test('app.js is a self-contained classic script with no network access', () => {
  const js = readFileSync(join(out.appDir, 'app.js'), 'utf8');
  assert.doesNotMatch(js, /^\s*(import|export)\s/m);
  assert.doesNotMatch(js, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/);
  const urls = [...js.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0])
    .filter((u) => !u.startsWith('http://www.w3.org/'));
  // Only URLs allowed are inside comments (spec links); none may be requested.
  for (const u of urls) assert.doesNotMatch(js, new RegExp(`(src|href|url)\\s*[=(:]\\s*['"\`]${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('SHA256SUMS.txt lists every shipped file', () => {
  const sums = readFileSync(join(out.appDir, 'SHA256SUMS.txt'), 'utf8');
  for (const f of ['app.js', 'index.html', 'style.css', 'THIRD_PARTY_LICENSES.txt']) assert.match(sums, new RegExp(`^[0-9a-f]{64}  ${f.replace('.', '\\.')}$`, 'm'));
});

const CHROME = [process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].find((p) => p && existsSync(p));

function chrome(file, ...args) {
  const profile = mkdtempSync(join(tmpdir(), 'pw-chrome-'));
  return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--virtual-time-budget=15000', ...args, pathToFileURL(file).href],
  { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] });
}
const dumpDom = (file) => chrome(file, '--dump-dom');

// Test-only harness: the unzipped files plus a script that clicks Generate and,
// optionally, a stylesheet that fixes the paper size.
function harness(app, name, pageSize) {
  const dir = join(app, '..', name);
  cpSync(app, dir, { recursive: true });
  writeFileSync(join(dir, 'click.js'),
    "document.addEventListener('DOMContentLoaded', () => document.getElementById('generate').click());");
  let html = readFileSync(join(app, 'index.html'), 'utf8').replace('</body>', '<script src="click.js"></script></body>');
  if (pageSize) {
    writeFileSync(join(dir, 'paper.css'), `@page { size: ${pageSize}; }`);
    html = html.replace('</head>', '<link rel="stylesheet" href="paper.css"></head>');
  }
  writeFileSync(join(dir, 'index.html'), html);
  return join(dir, 'index.html');
}

const e2e = { skip: !CHROME && 'no Chrome/Edge found (set CHROME_PATH)' };
let app;
function unzipped() {
  if (app) return app;
  // Unzip the actual artifact so the zip itself is what gets tested.
  const dir = mkdtempSync(join(tmpdir(), 'pw-e2e-'));
  const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\Windows', 'System32', 'tar.exe') : 'unzip';
  execFileSync(tar, process.platform === 'win32' ? ['-x', '-f', out.zipPath, '-C', dir] : [out.zipPath, '-d', dir]);
  return (app = join(dir, 'paper-wallet'));
}

const textOf = (html) => html.replace(/<[^>]+>/g, '');

test('page loads from file:// in a real browser, self-test passes, and generates all wallets', e2e, () => {
  const plain = dumpDom(join(unzipped(), 'index.html'));
  assert.match(plain, /Self-test passed: 18 known-answer checks/);

  const dom = dumpDom(harness(unzipped(), 'harness'));
  assert.equal((dom.match(/<section class="wallet">/g) || []).length, 6);
  for (const s of ['BTC', 'ETH', 'USDT', 'BNB', 'XRP', 'USDC', 'SOL', 'TRX', 'ZEC', 'HYPE',
    'DOGE', 'LINK', 'XMR', 'ADA', 'LEO', 'XLM', 'BCH']) assert.match(dom, new RegExp(`<span class="chip"[^>]*>${s}</span>`));
  const wordLists = [...dom.matchAll(/<ol class="words[^"]*">([\s\S]*?)<\/ol>/g)]
    .map((m) => (m[1].match(/<li>[a-z]+<\/li>/g) || []).length);
  assert.deepEqual(wordLists, [24, 25]); // Cardano, Monero
  assert.match(dom, /bc1q[02-9ac-hj-np-z]{38}/);
  assert.match(dom, /\b4[1-9A-HJ-NP-Za-km-z]{94}\b/); // Monero address
});

test('only public addresses get QR codes; secrets are plain, unhidden text for typing', e2e, () => {
  const dom = dumpDom(harness(unzipped(), 'harness'));
  const items = [...dom.matchAll(/<div class="item (public|secret)">([\s\S]*?)<\/div><\/div>/g)];
  const pub = items.filter((m) => m[1] === 'public');
  const sec = items.filter((m) => m[1] === 'secret');
  assert.equal(pub.length, 12);
  assert.equal(sec.length, 11);
  for (const m of pub) assert.match(m[2], /<svg /);
  for (const m of sec) assert.doesNotMatch(m[2], /<svg |class="qr"/);
  assert.equal((dom.match(/<svg /g) || []).length, 12);
  // Nothing hides secrets on screen: no blur toggle, class or filter.
  assert.doesNotMatch(dom, /blur/i);
  assert.doesNotMatch(readFileSync(join(unzipped(), 'style.css'), 'utf8'), /blur|:hover/);

  // Each secret reads back as one unbroken string (visual chunking must not add characters).
  const secrets = sec.flatMap((m) => [...m[2].matchAll(/<div class="value[^"]*">([\s\S]*?)<\/div>/g)].map((v) => textOf(v[1])));
  assert.equal(secrets.length, 9); // 11 secrets minus the two word lists
  for (const s of secrets) assert.match(s, /^\S+$/);
  const B58 = '[1-9A-HJ-NP-Za-km-z]';
  assert.equal(secrets.filter((s) => /^[0-9a-f]{64}$/.test(s)).length, 4); // BTC hex, EVM hex, XMR spend + view
  assert.equal(secrets.filter((s) => new RegExp(`^[KL]${B58}{51}$`).test(s)).length, 1); // BTC WIF
  assert.equal(secrets.filter((s) => new RegExp(`^Q${B58}{51}$`).test(s)).length, 1); // DOGE WIF
  assert.equal(secrets.filter((s) => /^S[A-Z2-7]{55}$/.test(s)).length, 1); // Stellar
  assert.equal(secrets.filter((s) => /^sEd[1-9A-HJ-NP-Za-km-z]{26,}$/.test(s)).length, 1); // XRP
  assert.equal(secrets.filter((s) => new RegExp(`^${B58}{86,88}$`).test(s)).length, 1); // Solana 64-byte
});

for (const [size, box] of [['A4', /\/MediaBox \[0 0 59[45][.\d]* 84[12][.\d]*\]/], ['letter', /\/MediaBox \[0 0 612 792\]/]]) {
  test(`all wallets print on a single ${size} page`, e2e, () => {
    const pdf = join(unzipped(), '..', `wallets-${size}.pdf`);
    chrome(harness(unzipped(), `print-${size}`, size), '--no-pdf-header-footer', `--print-to-pdf=${pdf}`);
    const raw = readFileSync(pdf, 'latin1');
    assert.match(raw, box);
    assert.equal((raw.match(/\/Type\s*\/Page\b/g) || []).length, 1);
  });
}
