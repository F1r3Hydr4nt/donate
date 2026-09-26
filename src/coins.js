// Pure key -> address derivations. Every function takes raw entropy bytes and is
// deterministic, so it can be tested against reference implementations.
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { ripemd160 } from '@noble/hashes/legacy.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { blake2b } from '@noble/hashes/blake2.js';
import { hmac } from '@noble/hashes/hmac.js';
import { pbkdf2 } from '@noble/hashes/pbkdf2.js';
import { bytesToHex, concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { base58, base58xmr, base58xrp, base32nopad, bech32, createBase58check } from '@scure/base';
import { entropyToMnemonic } from '@scure/bip39';
import { wordlist as bip39English } from '@scure/bip39/wordlists/english.js';
import { MONERO_WORDS } from './monero-wordlist.js';

const b58check = createBase58check(sha256);
const u8 = (...bytes) => Uint8Array.from(bytes);
const hash160 = (b) => ripemd160(sha256(b));

function requireBytes(b, len, what) {
  if (!(b instanceof Uint8Array) || b.length !== len) throw new Error(`${what}: expected ${len} bytes`);
}

function requireSecpKey(k) {
  requireBytes(k, 32, 'secp256k1 key');
  if (!secp256k1.utils.isValidSecretKey(k)) throw new Error('secp256k1 key out of range');
}

// Little-endian bytes <-> bigint (ed25519 / Monero / Cardano scalars are LE).
function leToBig(b) {
  let n = 0n;
  for (let i = b.length - 1; i >= 0; i--) n = (n << 8n) | BigInt(b[i]);
  return n;
}
function bigToLe(n, len) {
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++, n >>= 8n) out[i] = Number(n & 0xffn);
  return out;
}
const edScalarMulBase = (scalar) => ed25519.Point.BASE.multiply(scalar).toBytes();

// ---------------------------------------------------------------- Bitcoin family

// CashAddr (BCH) — https://github.com/bitcoincashorg/bitcoincash.org/blob/master/spec/cashaddr.md
const CASHADDR_GEN = [0x98f2bc8e61n, 0x79b76d99e2n, 0xf33e5fb3c4n, 0xae2eabe2a8n, 0x1e4f43e470n];
const BECH32_CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function cashaddrPolymod(values) {
  let c = 1n;
  for (const d of values) {
    const c0 = c >> 35n;
    c = ((c & 0x07ffffffffn) << 5n) ^ BigInt(d);
    for (let i = 0; i < 5; i++) if ((c0 >> BigInt(i)) & 1n) c ^= CASHADDR_GEN[i];
  }
  return c ^ 1n;
}
export function cashaddrEncode(prefix, type, hash) {
  // Version byte: type << 3 | size code (0 = 160 bits).
  const payload = bech32.toWords(concatBytes(u8(type << 3), hash));
  const prefixData = [...prefix].map((ch) => ch.charCodeAt(0) & 0x1f);
  const mod = cashaddrPolymod([...prefixData, 0, ...payload, 0, 0, 0, 0, 0, 0, 0, 0]);
  const checksum = Array.from({ length: 8 }, (_, i) => Number((mod >> BigInt(5 * (7 - i))) & 0x1fn));
  return `${prefix}:${[...payload, ...checksum].map((d) => BECH32_CHARSET[d]).join('')}`;
}

export function bitcoinFamily(priv) {
  requireSecpKey(priv);
  const h = hash160(secp256k1.getPublicKey(priv, true));
  const wif = (version) => b58check.encode(concatBytes(u8(version), priv, u8(0x01))); // compressed
  const btcWif = wif(0x80);
  return {
    hex: bytesToHex(priv),
    btc: {
      p2pkh: b58check.encode(concatBytes(u8(0x00), h)),
      p2wpkh: bech32.encode('bc', [0, ...bech32.toWords(h)]),
      wif: btcWif,
    },
    bch: { cashaddr: cashaddrEncode('bitcoincash', 0, h), wif: btcWif },
    doge: { address: b58check.encode(concatBytes(u8(0x1e), h)), wif: wif(0x9e) },
    zec: { address: b58check.encode(concatBytes(u8(0x1c, 0xb8), h)), wif: btcWif },
  };
}

// ---------------------------------------------------------------- EVM + TRON

function eip55(addrHex) {
  const hash = bytesToHex(keccak_256(utf8ToBytes(addrHex)));
  return '0x' + [...addrHex].map((c, i) => (parseInt(hash[i], 16) >= 8 ? c.toUpperCase() : c)).join('');
}

export function evmTron(priv) {
  requireSecpKey(priv);
  const addr = keccak_256(secp256k1.getPublicKey(priv, false).subarray(1)).subarray(12);
  return {
    hex: bytesToHex(priv),
    eth: eip55(bytesToHex(addr)),
    trx: b58check.encode(concatBytes(u8(0x41), addr)),
  };
}

// ---------------------------------------------------------------- ed25519: Solana + Stellar

function crc16xmodem(bytes) {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}
// Stellar StrKey — https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0023.md
function strkey(versionByte, data) {
  const payload = concatBytes(u8(versionByte), data);
  const crc = crc16xmodem(payload);
  return base32nopad.encode(concatBytes(payload, u8(crc & 0xff, crc >> 8)));
}

export function ed25519Group(seed) {
  requireBytes(seed, 32, 'ed25519 seed');
  const pub = ed25519.getPublicKey(seed);
  return {
    hex: bytesToHex(seed),
    sol: { address: base58.encode(pub), secret: base58.encode(concatBytes(seed, pub)) },
    xlm: { address: strkey(6 << 3, pub), secret: strkey(18 << 3, seed) },
  };
}

// ---------------------------------------------------------------- XRP (ed25519 family seed)

const xrpCheck = (payload) => base58xrp.encode(concatBytes(payload, sha256(sha256(payload)).subarray(0, 4)));

export function xrpWallet(entropy) {
  requireBytes(entropy, 16, 'XRP seed entropy');
  const pub = ed25519.getPublicKey(sha512(entropy).subarray(0, 32));
  const accountId = hash160(concatBytes(u8(0xed), pub));
  return {
    seed: xrpCheck(concatBytes(u8(0x01, 0xe1, 0x4b), entropy)),
    address: xrpCheck(concatBytes(u8(0x00), accountId)),
  };
}

// ---------------------------------------------------------------- Cardano (CIP-3 Icarus + BIP32-Ed25519, CIP-1852)

const ED_N = ed25519.Point.Fn.ORDER;
const HARD = 0x80000000;

function cardanoPublic(kL) {
  return edScalarMulBase(leToBig(kL) % ED_N);
}

function cardanoDerive({ kL, kR, cc }, index) {
  const i = bigToLe(BigInt(index), 4);
  const hardened = index >= HARD;
  const data = hardened ? concatBytes(kL, kR) : cardanoPublic(kL);
  const [zTag, cTag] = hardened ? [0x00, 0x01] : [0x02, 0x03];
  const z = hmac(sha512, cc, concatBytes(u8(zTag), data, i));
  const mod256 = 1n << 256n;
  return {
    kL: bigToLe((leToBig(z.subarray(0, 28)) * 8n + leToBig(kL)) % mod256, 32),
    kR: bigToLe((leToBig(z.subarray(32, 64)) + leToBig(kR)) % mod256, 32),
    cc: hmac(sha512, cc, concatBytes(u8(cTag), data, i)).subarray(32, 64),
  };
}

export function cardanoWallet(entropy) {
  requireBytes(entropy, 32, 'Cardano entropy');
  const k = pbkdf2(sha512, new Uint8Array(0), entropy, { c: 4096, dkLen: 96 });
  k[0] &= 0xf8;
  k[31] &= 0x1f;
  k[31] |= 0x40;
  const root = { kL: k.subarray(0, 32), kR: k.subarray(32, 64), cc: k.subarray(64, 96) };
  const account = [1852 + HARD, 1815 + HARD, 0 + HARD].reduce(cardanoDerive, root);
  const keyHash = (path) => blake2b(cardanoPublic(path.reduce(cardanoDerive, account).kL), { dkLen: 28 });
  const pay = keyHash([0, 0]);
  const stake = keyHash([2, 0]);
  const addr = (prefix, bytes) => bech32.encode(prefix, bech32.toWords(bytes), false);
  return {
    mnemonic: entropyToMnemonic(entropy, bip39English),
    address: addr('addr', concatBytes(u8(0x01), pay, stake)), // base address, mainnet
    stakeAddress: addr('stake', concatBytes(u8(0xe1), stake)),
  };
}

// ---------------------------------------------------------------- Monero

const XMR_L = 2n ** 252n + 27742317777372353535851937790883648493n;

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Legacy 25-word seed (monero-project src/mnemonics/electrum-words.cpp).
function moneroMnemonic(key) {
  const n = MONERO_WORDS.length;
  const view = new DataView(key.buffer, key.byteOffset, key.byteLength);
  const words = [];
  for (let i = 0; i < 32; i += 4) {
    const x = view.getUint32(i, true);
    const w1 = x % n;
    const w2 = (Math.floor(x / n) + w1) % n;
    const w3 = (Math.floor(Math.floor(x / n) / n) + w2) % n;
    words.push(MONERO_WORDS[w1], MONERO_WORDS[w2], MONERO_WORDS[w3]);
  }
  const prefixes = utf8ToBytes(words.map((w) => w.slice(0, 3)).join(''));
  words.push(words[crc32(prefixes) % words.length]);
  return words.join(' ');
}

export function moneroWallet(bytes) {
  requireBytes(bytes, 32, 'Monero entropy');
  const spend = leToBig(bytes) % XMR_L;
  const view = leToBig(keccak_256(bigToLe(spend, 32))) % XMR_L;
  if (spend === 0n || view === 0n) throw new Error('degenerate Monero key');
  const data = concatBytes(u8(0x12), edScalarMulBase(spend), edScalarMulBase(view));
  const spendBytes = bigToLe(spend, 32);
  return {
    spendKey: bytesToHex(spendBytes),
    viewKey: bytesToHex(bigToLe(view, 32)),
    address: base58xmr.encode(concatBytes(data, keccak_256(data).subarray(0, 4))),
    mnemonic: moneroMnemonic(spendBytes),
  };
}
