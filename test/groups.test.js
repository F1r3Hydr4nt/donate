import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

import { GROUPS, generateWallets, COIN_LIST } from '../src/groups.js';

const TOP_17 = ['BTC', 'ETH', 'USDT', 'BNB', 'XRP', 'USDC', 'SOL', 'TRX', 'ZEC', 'HYPE',
  'DOGE', 'LINK', 'XMR', 'ADA', 'LEO', 'XLM', 'BCH'];

test('every top-17 coin is covered by exactly one group', () => {
  const seen = GROUPS.flatMap((g) => g.symbols);
  assert.deepEqual([...seen].sort(), [...TOP_17].sort());
  assert.deepEqual(COIN_LIST.map((c) => c.symbol).sort(), [...TOP_17].sort());
});

test('generated wallets expose an address for every coin and non-empty keys', () => {
  const wallets = generateWallets(randomBytes);
  const addressed = new Set(wallets.flatMap((w) => w.addresses.flatMap((a) => a.symbols)));
  for (const s of TOP_17) assert.ok(addressed.has(s), `no address for ${s}`);
  for (const w of wallets) {
    assert.ok(w.keys.length > 0, `${w.id} has no keys`);
    for (const item of [...w.keys, ...w.addresses]) {
      assert.equal(typeof item.value, 'string');
      assert.ok(item.value.length > 20, `${w.id}/${item.label} looks empty`);
      assert.ok(item.label);
    }
  }
});

test('each group draws its own entropy of the declared size', () => {
  const calls = [];
  let counter = 1;
  const fakeRandom = (n) => {
    calls.push(n);
    return new Uint8Array(n).fill(counter++);
  };
  const wallets = generateWallets(fakeRandom);
  assert.deepEqual(calls, GROUPS.map((g) => g.entropyBytes));
  // Deterministic for identical entropy, different across groups.
  let c2 = 1;
  const again = generateWallets((n) => new Uint8Array(n).fill(c2++));
  assert.deepEqual(again, wallets);
  const btc = wallets.find((w) => w.id === 'bitcoin').keys[0].value;
  const evm = wallets.find((w) => w.id === 'evm').keys[0].value;
  assert.notEqual(btc.slice(-10), evm.slice(-10));
});

test('recovery phrases are flagged so they render as numbered words', () => {
  const wallets = generateWallets(randomBytes);
  const phrases = wallets.flatMap((w) => w.keys.filter((k) => k.mnemonic).map((k) => [w.id, k.value.split(' ').length]));
  assert.deepEqual(phrases, [['cardano', 24], ['monero', 25]]);
});

test('only selected groups are generated', () => {
  const wallets = generateWallets(randomBytes, ['xrp', 'monero']);
  assert.deepEqual(wallets.map((w) => w.id), ['xrp', 'monero']);
});

test('secp256k1 groups retry when the rng yields an invalid key', () => {
  const seq = [new Uint8Array(32), new Uint8Array(32).fill(0xff), new Uint8Array(32).fill(3)];
  const wallets = generateWallets(() => seq.shift(), ['bitcoin']);
  assert.equal(wallets[0].keys.find((k) => k.label.includes('hex')).value, '03'.repeat(32));
});

test('rejects rng output of the wrong length or type', () => {
  assert.throws(() => generateWallets(() => new Uint8Array(8), ['xrp']));
  assert.throws(() => generateWallets(() => 'nope', ['xrp']));
});

test('raw entropy is wiped once the keys are derived', () => {
  const drawn = [];
  const wallets = generateWallets((n) => {
    const b = new Uint8Array(n).fill(drawn.length + 1);
    drawn.push(b);
    return b;
  });
  assert.equal(wallets.length, GROUPS.length);
  for (const b of drawn) assert.ok(b.every((x) => x === 0), 'entropy buffer still holds key material');
});

test('Monero redraws entropy that would give a biased spend key', () => {
  // 0xff..ff is above 15·ℓ, the largest multiple of ℓ below 2^256, so reducing it mod ℓ
  // would favour small scalars. It must be rejected, not reduced.
  const seq = [new Uint8Array(32).fill(0xff), new Uint8Array(32).fill(5)];
  const sizes = [];
  const [xmr] = generateWallets((n) => { sizes.push(n); return seq.shift(); }, ['monero']);
  assert.deepEqual(sizes, [32, 32]);
  assert.equal(xmr.keys.find((k) => /spend/.test(k.label)).value, '05'.repeat(32));
});
