// Cross-checks every derivation in src/coins.js against independent, widely used
// reference libraries (dev dependencies only — none of them ship in the bundle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';

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

import {
  bitcoinFamily, evmTron, ed25519Group, xrpWallet, cardanoWallet, moneroWallet,
} from '../src/coins.js';

const ECPair = ECPairFactory(ecc);
const hex = (b) => Buffer.from(b).toString('hex');
const DOGE = {
  messagePrefix: '\x19Dogecoin Signed Message:\n', bech32: 'doge',
  bip32: { public: 0x02facafd, private: 0x02fac398 }, pubKeyHash: 0x1e, scriptHash: 0x16, wif: 0x9e,
};

// A fixed edge-ish set plus fresh random keys on every run.
const secpKeys = [
  Buffer.from('00'.repeat(31) + '01', 'hex'),
  Buffer.from('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318', 'hex'),
  Buffer.from('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364140', 'hex'), // n-1
  ...Array.from({ length: 8 }, () => randomBytes(32)),
];

test('bitcoin family: known vector for private key 1', () => {
  const w = bitcoinFamily(secpKeys[0]);
  assert.equal(w.btc.p2pkh, '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH');
  assert.equal(w.btc.p2wpkh, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'); // BIP-173 example
  assert.equal(w.btc.wif, 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn');
});

test('bitcoin family matches bitcoinjs-lib / bchaddrjs / bs58check', () => {
  for (const k of secpKeys) {
    const w = bitcoinFamily(k);
    const pair = ECPair.fromPrivateKey(k);
    const pubkey = Buffer.from(pair.publicKey);
    assert.equal(w.hex, hex(k));
    assert.equal(w.btc.wif, pair.toWIF());
    assert.equal(w.btc.p2pkh, bitcoin.payments.p2pkh({ pubkey }).address);
    assert.equal(w.btc.p2wpkh, bitcoin.payments.p2wpkh({ pubkey }).address);

    assert.equal(w.bch.wif, pair.toWIF());
    assert.equal(w.bch.cashaddr, bchaddr.toCashAddress(w.btc.p2pkh));

    const dogePair = ECPair.fromPrivateKey(k, { network: DOGE });
    assert.equal(w.doge.wif, dogePair.toWIF());
    assert.equal(w.doge.address, bitcoin.payments.p2pkh({ pubkey, network: DOGE }).address);

    const h160 = bitcoin.crypto.hash160(pubkey);
    assert.equal(w.zec.address, bs58check.encode(Buffer.concat([Buffer.from([0x1c, 0xb8]), h160])));
    assert.ok(w.zec.address.startsWith('t1'));
    assert.equal(w.zec.wif, pair.toWIF());
  }
});

test('evm + tron match ethers / tronweb', () => {
  const w0 = evmTron(secpKeys[1]);
  assert.equal(w0.eth, '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23'); // web3.js docs vector
  for (const k of secpKeys) {
    const w = evmTron(k);
    assert.equal(w.hex, hex(k));
    assert.equal(w.eth, new Wallet('0x' + hex(k)).address); // includes EIP-55 checksum casing
    assert.equal(w.trx, TronWeb.address.fromPrivateKey(hex(k)));
  }
});

test('bitcoin family and evm reject invalid secp256k1 keys', () => {
  const zero = new Uint8Array(32);
  const n = Buffer.from('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141', 'hex');
  for (const bad of [zero, n, new Uint8Array(31)]) {
    assert.throws(() => bitcoinFamily(bad));
    assert.throws(() => evmTron(bad));
  }
});

test('ed25519 group (SOL, XLM) matches @solana/web3.js / stellar-base', () => {
  for (let i = 0; i < 10; i++) {
    const seed = randomBytes(32);
    const w = ed25519Group(seed);
    const sol = SolKeypair.fromSeed(seed);
    assert.equal(w.sol.address, sol.publicKey.toBase58());
    // Phantom / Solflare import format: base58 of the 64-byte secret key (seed || pubkey)
    assert.deepEqual(base58.decode(w.sol.secret), new Uint8Array(sol.secretKey));
    const xlm = XlmKeypair.fromRawEd25519Seed(seed);
    assert.equal(w.xlm.address, xlm.publicKey());
    assert.equal(w.xlm.secret, xlm.secret());
  }
});

test('xrp (ed25519 family seed) matches ripple-keypairs', () => {
  for (let i = 0; i < 10; i++) {
    const entropy = randomBytes(16);
    const w = xrpWallet(entropy);
    const seed = rippleKeypairs.generateSeed({ entropy, algorithm: 'ed25519' });
    assert.equal(w.seed, seed);
    assert.ok(w.seed.startsWith('sEd'));
    assert.equal(w.address, rippleKeypairs.deriveAddress(rippleKeypairs.deriveKeypair(seed).publicKey));
  }
  assert.throws(() => xrpWallet(new Uint8Array(32)));
});

function cslAddresses(entropy) {
  const h = (n) => (n | 0x80000000) >>> 0;
  const acct = CSL.Bip32PrivateKey.from_bip39_entropy(entropy, new Uint8Array())
    .derive(h(1852)).derive(h(1815)).derive(h(0));
  const pay = acct.derive(0).derive(0).to_public().to_raw_key().hash();
  const stake = acct.derive(2).derive(0).to_public().to_raw_key().hash();
  const payCred = CSL.Credential.from_keyhash(pay);
  const stakeCred = CSL.Credential.from_keyhash(stake);
  return {
    address: CSL.BaseAddress.new(1, payCred, stakeCred).to_address().to_bech32(),
    stakeAddress: CSL.RewardAddress.new(1, stakeCred).to_address().to_bech32(),
  };
}

test('cardano (24-word CIP-1852 wallet) matches cardano-serialization-lib', async () => {
  const { mnemonicToEntropy } = await import('@scure/bip39');
  const { wordlist } = await import('@scure/bip39/wordlists/english.js');
  const fixed = [new Uint8Array(32), new Uint8Array(32).fill(0xff)];
  for (const entropy of [...fixed, ...Array.from({ length: 8 }, () => randomBytes(32))]) {
    const w = cardanoWallet(entropy);
    const ref = cslAddresses(entropy);
    assert.equal(w.mnemonic.split(' ').length, 24);
    assert.deepEqual(mnemonicToEntropy(w.mnemonic, wordlist), new Uint8Array(entropy));
    assert.equal(w.address, ref.address);
    assert.equal(w.stakeAddress, ref.stakeAddress);
  }
  assert.throws(() => cardanoWallet(new Uint8Array(16)));
});

test('monero matches monero-ts (address, view key, 25-word seed)', async () => {
  const inputs = [new Uint8Array(32).fill(0xff), ...Array.from({ length: 5 }, () => randomBytes(32))];
  for (const bytes of inputs) {
    const w = moneroWallet(bytes);
    const ref = await moneroTs.createWalletKeys({
      networkType: moneroTs.MoneroNetworkType.MAINNET, privateSpendKey: w.spendKey,
    });
    assert.equal(w.address, await ref.getPrimaryAddress());
    assert.equal(w.viewKey, await ref.getPrivateViewKey());
    assert.equal(w.mnemonic, await ref.getSeed());
    // The input must actually be used (reduced mod l), not ignored.
    const fromSeed = await moneroTs.createWalletKeys({
      networkType: moneroTs.MoneroNetworkType.MAINNET, seed: w.mnemonic,
    });
    assert.equal(await fromSeed.getPrivateSpendKey(), w.spendKey);
  }
  // A canonical (already reduced) key is used as-is.
  const small = new Uint8Array(32); small[0] = 5;
  assert.equal(moneroWallet(small).spendKey, '05' + '00'.repeat(31));
});
