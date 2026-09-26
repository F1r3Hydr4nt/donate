// Known-answer tests run in the browser before any key is generated. Expected
// values come from independent reference libraries (see test/coins.test.js).
import { bitcoinFamily, evmTron, ed25519Group, xrpWallet, cardanoWallet, moneroWallet } from './coins.js';

const fill = (len, v) => new Uint8Array(len).fill(v);
const fromHex = (h) => Uint8Array.from(h.match(/../g), (b) => parseInt(b, 16));
const one = fromHex('00'.repeat(31) + '01');

const VECTORS = [
  ['BTC legacy', () => bitcoinFamily(one).btc.p2pkh, '1BgGZ9tcN4rm9KBzDn7KprQz87SZ26SAMH'],
  ['BTC SegWit', () => bitcoinFamily(one).btc.p2wpkh, 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'],
  ['BTC WIF', () => bitcoinFamily(one).btc.wif, 'KwDiBf89QgGbjEhKnhXJuH7LrciVrZi3qYjgd9M7rFU73sVHnoWn'],
  ['BCH CashAddr', () => bitcoinFamily(one).bch.cashaddr, 'bitcoincash:qp63uahgrxged4z5jswyt5dn5v3lzsem6cy4spdc2h'],
  ['DOGE', () => bitcoinFamily(one).doge.address, 'DFpN6QqFfUm3gKNaxN6tNcab1FArL9cZLE'],
  ['ZEC transparent', () => bitcoinFamily(one).zec.address, 't1UYsZVJkLPeMjxEtACvSxfWuNmddpWfxzs'],
  ['ETH (EIP-55)', () => evmTron(fromHex('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318')).eth,
    '0x2c7536E3605D9C16a7a3D7b1898e529396a65c23'],
  ['TRX', () => evmTron(fromHex('4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318')).trx,
    'TE2H9hWjzYdwzDFRJfx9BFhr4MmjH1CHaz'],
  ['SOL', () => ed25519Group(fill(32, 1)).sol.address, 'AKnL4NNf3DGWZJS6cPknBuEGnVsV4A4m5tgebLHaRSZ9'],
  ['XLM', () => ed25519Group(fill(32, 1)).xlm.address, 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR'],
  ['XLM secret', () => ed25519Group(fill(32, 1)).xlm.secret, 'SAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC5MY'],
  ['XRP seed', () => xrpWallet(fill(16, 7)).seed, 'sEdSPx8CLbFUna3DJdvJ74aQPLdemqu'],
  ['XRP address', () => xrpWallet(fill(16, 7)).address, 'rEhh6f9rj5UUBhFzGGaxS5zYU2CCqKFXBC'],
  ['ADA', () => cardanoWallet(fill(32, 0)).address,
    'addr1qyqt0pru382hy9vjlsxv3ye02z50sfvt8xunscg5pgden77z73dpdfng2ctw2ekqplqgrljelz7h4dneac27nn3qx3rqrhqvwd'],
  ['XMR address', () => moneroWallet(fromHex('00'.repeat(31) + '01')).address,
    '42nsXK8WbVGTNayQ6Kjw5UdgqbQY5KCCufdxdCgF7NgTfjC69Mna7DJSYyie77hZTQ8H92G2HwgFhgEUYnDzrnLnQdF28r3'],
  ['XMR view key', () => moneroWallet(fromHex('00'.repeat(31) + '01')).viewKey,
    'cea3c5dfea43f31197bd4b7166da59f90af44b4afac2b0732d9fcbe2b7fa0c06'],
  ['XMR seed', () => moneroWallet(fromHex('00'.repeat(31) + '01')).mnemonic,
    `${'abbey '.repeat(21)}bamboo jaws jerseys abbey`],
];

function checkRandom(randomBytes) {
  const a = randomBytes(32);
  const b = randomBytes(32);
  if (!(a instanceof Uint8Array) || a.length !== 32) return 'random source did not return 32 bytes';
  if (a.every((x, i) => x === b[i])) return 'random source returned the same bytes twice';
  if (new Set(a).size < 8) return 'random output has suspiciously few distinct bytes';
  return null;
}

export function runSelfTest(randomBytes) {
  const results = VECTORS.map(([name, fn, expected]) => {
    try {
      const actual = fn();
      return { name, ok: actual === expected, detail: actual === expected ? '' : `got ${actual}` };
    } catch (e) {
      return { name, ok: false, detail: String(e && e.message) };
    }
  });
  let rngError;
  try { rngError = checkRandom(randomBytes); } catch (e) { rngError = String(e && e.message); }
  results.push({ name: 'Random number generator', ok: !rngError, detail: rngError || '' });
  return results;
}
