import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import * as bitcoin from 'bitcoinjs-lib';
import { ECPairFactory } from 'ecpair';
import * as ecc from 'tiny-secp256k1';
import bs58check from 'bs58check';
import bchaddr from 'bchaddrjs';
import { Wallet } from 'ethers';
import { TronWeb } from 'tronweb';
import { Keypair as SolKeypair } from '@solana/web3.js';
import { Keypair as XlmKeypair } from '@stellar/stellar-base';
import * as rippleKeypairs from 'ripple-keypairs';
import CSL from '@emurgo/cardano-serialization-lib-nodejs';
import moneroTs from 'monero-ts';
import { base58 } from '@scure/base';
import { mnemonicToEntropy } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

import { build } from '../scripts/build.mjs';

let out;
before(async () => {
  out = await build({ outDir: mkdtempSync(join(tmpdir(), 'pw-build-')) });
});

test('bundle contains exactly the offline files', () => {
  assert.deepEqual(readdirSync(out.appDir).sort(), ['SHA256SUMS.txt', 'THIRD_PARTY_LICENSES.txt', 'index.html']);
  assert.ok(existsSync(out.zipPath));
});

const pageHtml = () => readFileSync(join(out.appDir, 'index.html'), 'utf8');
// The one inline <script> and <style> in the built page.
const inlineScript = () => {
  const scripts = [...pageHtml().matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(scripts[0][1], '');
  return scripts[0][2];
};
const inlineStyle = () => {
  const styles = [...pageHtml().matchAll(/<style>([\s\S]*?)<\/style>/g)];
  assert.equal(styles.length, 1);
  return styles[0][1];
};

// Tails opens files picked with Ctrl+O through a portal that exposes only that one
// file, so the page must not load anything else from disk.
test('index.html is self-contained: script and styles inline, nothing loaded from disk', () => {
  const html = pageHtml();
  assert.doesNotMatch(html, /<script\b[^>]*\bsrc=/i);
  assert.doesNotMatch(html, /<link\b/i);
  assert.doesNotMatch(html, /type="module"/);
  assert.match(inlineStyle(), /\.secret-value/);
  // An early </script> or <!-- inside the script would end or garble it.
  assert.doesNotMatch(inlineScript(), /<\/script|<!--/i);
});

test('CSP allows only the inline script, by hash', () => {
  const csp = pageHtml().match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src '));
  const hash = createHash('sha256').update(inlineScript(), 'utf8').digest('base64');
  assert.equal(scriptSrc, `script-src 'sha256-${hash}'`);
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'none'/);
});

test('inline script is a self-contained classic script with no network access', () => {
  const js = inlineScript();
  assert.doesNotMatch(js, /^\s*(import|export)\s/m);
  assert.doesNotMatch(js, /\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/);
  const urls = [...js.matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0])
    .filter((u) => !u.startsWith('http://www.w3.org/'));
  // Only URLs allowed are inside comments (spec links); none may be requested.
  for (const u of urls) assert.doesNotMatch(js, new RegExp(`(src|href|url)\\s*[=(:]\\s*['"\`]${u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));
});

test('SHA256SUMS.txt lists every shipped file', () => {
  const sums = readFileSync(join(out.appDir, 'SHA256SUMS.txt'), 'utf8');
  for (const f of ['index.html', 'THIRD_PARTY_LICENSES.txt']) assert.match(sums, new RegExp(`^[0-9a-f]{64}  ${f.replace('.', '\\.')}$`, 'm'));
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
// Rendered markup only: the inline script's source would otherwise match page patterns.
const dumpDom = (file) => chrome(file, '--dump-dom').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');

// Test-only harness: the unzipped files plus a script that clicks Generate and,
// optionally, a stylesheet that fixes the paper size.
function harness(app, name, pageSize) {
  const dir = join(app, '..', name);
  cpSync(app, dir, { recursive: true });
  writeFileSync(join(dir, 'click.js'),
    "document.addEventListener('DOMContentLoaded', () => document.getElementById('generate').click());");
  // The shipped CSP only admits the inline script, so let the harness files in too.
  let html = readFileSync(join(app, 'index.html'), 'utf8')
    .replace("script-src ", "script-src 'self' ").replace("style-src ", "style-src 'self' ")
    .replace('</body>', '<script src="click.js"></script></body>');
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

  // Same page copied on its own, as the Tails file-picker portal serves it.
  const alone = mkdtempSync(join(tmpdir(), 'pw-alone-'));
  cpSync(join(unzipped(), 'index.html'), join(alone, 'index.html'));
  assert.match(dumpDom(join(alone, 'index.html')), /Self-test passed: 18 known-answer checks/);

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
  assert.doesNotMatch(inlineStyle(), /blur|:hover/);

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

// Reads the page the way a person would: each wallet's printed secrets and
// addresses, with chunked secrets joined and word lists joined by spaces.
function printedWallets(dom) {
  return [...dom.matchAll(/<section class="wallet">([\s\S]*?)<\/section>/g)].map(([, s]) => {
    const items = [...s.matchAll(/<div class="item (public|secret)">([\s\S]*?)<\/div><\/div>/g)].map(([, kind, body]) => {
      const words = body.match(/<ol class="words[^"]*">([\s\S]*?)<\/ol>/);
      return {
        kind,
        label: textOf(body.match(/<div class="item-label">([\s\S]*?)<\/div>/)[1]),
        value: words ? [...words[1].matchAll(/<li>([a-z]+)<\/li>/g)].map((w) => w[1]).join(' ')
          : textOf(body.match(/<div class="value[^"]*">([\s\S]*?)(?:<\/div>|$)/)[1]),
      };
    });
    const pick = (kind) => (re) => {
      const hits = items.filter((i) => i.kind === kind && re.test(i.label));
      assert.equal(hits.length, 1, `expected one ${kind} item matching ${re}`);
      return hits[0].value;
    };
    return { pub: pick('public'), sec: pick('secret') };
  });
}

const ECPair = ECPairFactory(ecc);
const DOGE = {
  messagePrefix: '\x19Dogecoin Signed Message:\n', bech32: 'doge',
  bip32: { public: 0x02facafd, private: 0x02fac398 }, pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e,
};

test('every printed secret, re-imported with reference libs, gives the address printed beside it', e2e, async () => {
  for (let run = 0; run < 3; run++) {
    const [btc, evm, ed, xrp, ada, xmr] = printedWallets(dumpDom(harness(unzipped(), `oracle-${run}`)));

    const pair = ECPair.fromWIF(btc.sec(/WIF \(BTC/));
    const pubkey = Buffer.from(pair.publicKey);
    assert.equal(Buffer.from(pair.privateKey).toString('hex'), btc.sec(/hex/));
    assert.equal(bitcoin.payments.p2wpkh({ pubkey }).address, btc.pub(/SegWit/));
    assert.equal(bitcoin.payments.p2pkh({ pubkey }).address, btc.pub(/legacy/));
    assert.equal(bchaddr.toCashAddress(btc.pub(/legacy/)), btc.pub(/Cash/));
    assert.equal(bs58check.encode(Buffer.concat([Buffer.from([0x1c, 0xb8]), bitcoin.crypto.hash160(pubkey)])), btc.pub(/Zcash/));
    const doge = ECPair.fromWIF(btc.sec(/DOGE/), DOGE);
    assert.equal(Buffer.from(doge.privateKey).toString('hex'), btc.sec(/hex/));
    assert.equal(bitcoin.payments.p2pkh({ pubkey: Buffer.from(doge.publicKey), network: DOGE }).address, btc.pub(/Dogecoin/));

    assert.equal(new Wallet('0x' + evm.sec(/hex/)).address, evm.pub(/EVM/));
    assert.equal(TronWeb.address.fromPrivateKey(evm.sec(/hex/)), evm.pub(/TRON/));

    // fromSecretKey also checks the embedded public half of the 64-byte key.
    assert.equal(SolKeypair.fromSecretKey(base58.decode(ed.sec(/Solana/))).publicKey.toBase58(), ed.pub(/Solana/));
    assert.equal(XlmKeypair.fromSecret(ed.sec(/Stellar/)).publicKey(), ed.pub(/Stellar/));

    assert.equal(rippleKeypairs.deriveAddress(rippleKeypairs.deriveKeypair(xrp.sec(/seed/)).publicKey), xrp.pub(/XRP/));

    const h = (n) => (n | 0x80000000) >>> 0;
    const acct = CSL.Bip32PrivateKey.from_bip39_entropy(mnemonicToEntropy(ada.sec(/24-word/), wordlist), new Uint8Array())
      .derive(h(1852)).derive(h(1815)).derive(h(0));
    const cred = (role) => CSL.Credential.from_keyhash(acct.derive(role).derive(0).to_public().to_raw_key().hash());
    assert.equal(CSL.BaseAddress.new(1, cred(0), cred(2)).to_address().to_bech32(), ada.pub(/Cardano/));

    const restored = await moneroTs.createWalletKeys({ networkType: moneroTs.MoneroNetworkType.MAINNET, seed: xmr.sec(/mnemonic/) });
    assert.equal(await restored.getPrimaryAddress(), xmr.pub(/Monero/));
    assert.equal(await restored.getPrivateSpendKey(), xmr.sec(/spend/));
    assert.equal(await restored.getPrivateViewKey(), xmr.sec(/view/));
  }
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
