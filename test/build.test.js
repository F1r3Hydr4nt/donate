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

function dumpDom(file) {
  const profile = mkdtempSync(join(tmpdir(), 'pw-chrome-'));
  return execFileSync(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--user-data-dir=${profile}`, '--virtual-time-budget=15000', '--dump-dom', pathToFileURL(file).href],
  { encoding: 'utf8', timeout: 90000, stdio: ['ignore', 'pipe', 'ignore'] });
}

test('page loads from file:// in a real browser, self-test passes, and generates all wallets',
  { skip: !CHROME && 'no Chrome/Edge found (set CHROME_PATH)' }, () => {
    // Unzip the actual artifact so the zip itself is what gets tested.
    const dir = mkdtempSync(join(tmpdir(), 'pw-e2e-'));
    const tar = process.platform === 'win32' ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe') : 'unzip';
    execFileSync(tar, process.platform === 'win32' ? ['-x', '-f', out.zipPath, '-C', dir] : [out.zipPath, '-d', dir]);
    const app = join(dir, 'paper-wallet');

    const plain = dumpDom(join(app, 'index.html'));
    assert.match(plain, /Self-test passed: 18 known-answer checks/);

    // Test-only harness page: same files plus a script that clicks Generate.
    cpSync(app, join(dir, 'harness'), { recursive: true });
    writeFileSync(join(dir, 'harness', 'click.js'),
      "document.addEventListener('DOMContentLoaded', () => document.getElementById('generate').click());");
    const html = readFileSync(join(app, 'index.html'), 'utf8').replace('</body>', '<script src="click.js"></script></body>');
    writeFileSync(join(dir, 'harness', 'index.html'), html);
    const dom = dumpDom(join(dir, 'harness', 'index.html'));

    assert.equal((dom.match(/<section class="wallet">/g) || []).length, 6);
    assert.equal((dom.match(/<svg /g) || []).length, 23); // 12 addresses + 11 secrets
    for (const s of ['BTC', 'ETH', 'USDT', 'BNB', 'XRP', 'USDC', 'SOL', 'TRX', 'ZEC', 'HYPE',
      'DOGE', 'LINK', 'XMR', 'ADA', 'LEO', 'XLM', 'BCH']) assert.match(dom, new RegExp(`<span class="chip"[^>]*>${s}</span>`));
    const wordLists = [...dom.matchAll(/<ol class="words[^"]*">([\s\S]*?)<\/ol>/g)]
      .map((m) => (m[1].match(/<li>[a-z]+<\/li>/g) || []).length);
    assert.deepEqual(wordLists, [24, 25]); // Cardano, Monero
    assert.match(dom, /bc1q[02-9ac-hj-np-z]{38}/);
    assert.match(dom, /\b4[1-9A-HJ-NP-Za-km-z]{94}\b/); // Monero address
  });
