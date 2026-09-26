// Groups coins that can share one key-derivation scheme, and turns raw
// derivations into a display model (labelled keys + addresses + notes).
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bitcoinFamily, evmTron, ed25519Group, xrpWallet, cardanoWallet, moneroWallet } from './coins.js';

// CoinMarketCap top 17 by market cap (Sept 2026), in rank order.
export const COIN_LIST = [
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'USDT', name: 'Tether' },
  { symbol: 'BNB', name: 'BNB' },
  { symbol: 'XRP', name: 'XRP' },
  { symbol: 'USDC', name: 'USDC' },
  { symbol: 'SOL', name: 'Solana' },
  { symbol: 'TRX', name: 'TRON' },
  { symbol: 'ZEC', name: 'Zcash' },
  { symbol: 'HYPE', name: 'Hyperliquid' },
  { symbol: 'DOGE', name: 'Dogecoin' },
  { symbol: 'LINK', name: 'Chainlink' },
  { symbol: 'XMR', name: 'Monero' },
  { symbol: 'ADA', name: 'Cardano' },
  { symbol: 'LEO', name: 'UNUS SED LEO' },
  { symbol: 'XLM', name: 'Stellar' },
  { symbol: 'BCH', name: 'Bitcoin Cash' },
];

const MAX_SECP_ATTEMPTS = 16;

export const GROUPS = [
  {
    id: 'bitcoin',
    title: 'Bitcoin family',
    scheme: 'secp256k1 · HASH160 · Base58Check / Bech32 / CashAddr',
    symbols: ['BTC', 'BCH', 'DOGE', 'ZEC'],
    entropyBytes: 32,
    secp256k1: true,
    build(key) {
      const w = bitcoinFamily(key);
      return {
        keys: [
          { label: 'Private key — WIF (BTC, BCH, ZEC)', value: w.btc.wif,
            hint: 'Sweep/import in Electrum (prefix "p2wpkh:" for the bc1q address), Electron Cash, zcashd importprivkey.' },
          { label: 'Private key — WIF (DOGE)', value: w.doge.wif, hint: 'Import/sweep in Dogecoin Core or Electrum-DOGE.' },
          { label: 'Private key (hex)', value: w.hex, hint: 'Raw 32-byte key shared by every address in this group.' },
        ],
        addresses: [
          { symbols: ['BTC'], label: 'Bitcoin — native SegWit (bc1q…)', value: w.btc.p2wpkh },
          { symbols: ['BTC'], label: 'Bitcoin — legacy (1…)', value: w.btc.p2pkh },
          { symbols: ['BCH'], label: 'Bitcoin Cash — CashAddr', value: w.bch.cashaddr },
          { symbols: ['DOGE'], label: 'Dogecoin', value: w.doge.address },
          { symbols: ['ZEC'], label: 'Zcash — transparent (t1…)', value: w.zec.address },
        ],
        notes: [
          'One key controls all five addresses. Balances on each chain are separate.',
          'Zcash: this is a transparent address. Most shielded-only wallets (e.g. Zashi) cannot import a WIF key; use zcashd/zallet.',
        ],
      };
    },
  },
  {
    id: 'evm',
    title: 'Ethereum, EVM tokens & TRON',
    scheme: 'secp256k1 · Keccak-256 · EIP-55 hex / Base58Check',
    symbols: ['ETH', 'USDT', 'USDC', 'BNB', 'LINK', 'LEO', 'HYPE', 'TRX'],
    entropyBytes: 32,
    secp256k1: true,
    build(key) {
      const w = evmTron(key);
      return {
        keys: [
          { label: 'Private key (hex)', value: w.hex,
            hint: 'Import as a private key in MetaMask, Rabby (EVM chains) or TronLink (TRON).' },
        ],
        addresses: [
          { symbols: ['ETH', 'USDT', 'USDC', 'LINK', 'LEO', 'BNB', 'HYPE'],
            label: 'EVM address — Ethereum (ERC-20), BNB Smart Chain, Hyperliquid / HyperEVM', value: w.eth },
          { symbols: ['TRX', 'USDT'], label: 'TRON address (TRX, USDT TRC-20)', value: w.trx },
        ],
        notes: [
          'The same EVM address exists on every EVM chain. Always check which network a sender uses (ERC-20 vs BEP-20).',
          'BNB means BNB Smart Chain (BEP-20). The old BNB Beacon Chain (bnb1… addresses) has been shut down.',
          'Token transfers need gas: ETH on Ethereum, BNB on BSC, TRX (or energy) on TRON.',
        ],
      };
    },
  },
  {
    id: 'ed25519',
    title: 'Solana & Stellar',
    scheme: 'ed25519 (RFC 8032) · Base58 / StrKey',
    symbols: ['SOL', 'XLM'],
    entropyBytes: 32,
    build(seed) {
      const w = ed25519Group(seed);
      return {
        keys: [
          { label: 'Solana secret key (base58, 64-byte)', value: w.sol.secret, hint: 'Phantom / Solflare → Import private key.' },
          { label: 'Stellar secret seed (S…)', value: w.xlm.secret, hint: 'LOBSTR / Freighter / Stellar Laboratory → import secret key.' },
        ],
        addresses: [
          { symbols: ['SOL'], label: 'Solana', value: w.sol.address },
          { symbols: ['XLM'], label: 'Stellar', value: w.xlm.address },
        ],
        notes: [
          'Both chains use the same 32-byte ed25519 seed, encoded two ways.',
          'A Stellar account needs a minimum balance of 1 XLM before it exists on-chain.',
        ],
      };
    },
  },
  {
    id: 'xrp',
    title: 'XRP Ledger',
    scheme: 'ed25519 family seed (sEd…) · SHA-512Half · Ripple Base58Check',
    symbols: ['XRP'],
    entropyBytes: 16,
    build(entropy) {
      const w = xrpWallet(entropy);
      return {
        keys: [{ label: 'XRP family seed (secret)', value: w.seed, hint: 'Xaman → Import account → Family seed; or xrpl.js Wallet.fromSeed().' }],
        addresses: [{ symbols: ['XRP'], label: 'XRP Ledger', value: w.address }],
        notes: ['The account needs the base reserve (currently 1 XRP) before it exists on-chain; that amount stays locked.'],
      };
    },
  },
  {
    id: 'cardano',
    title: 'Cardano',
    scheme: 'BIP-39 · Icarus BIP32-Ed25519 · CIP-1852 m/1852\'/1815\'/0\'/0/0 · Blake2b-224',
    symbols: ['ADA'],
    entropyBytes: 32,
    build(entropy) {
      const w = cardanoWallet(entropy);
      return {
        keys: [{ label: '24-word recovery phrase (Shelley)', value: w.mnemonic, mnemonic: true, hint: 'Restore in Eternl, Lace, Yoroi or Typhon as a 24-word wallet (no passphrase).' }],
        addresses: [{ symbols: ['ADA'], label: 'Cardano — first base address (addr1…)', value: w.address }],
        notes: ['Wallets rotate receive addresses, so the restored wallet will show this as its first address.'],
      };
    },
  },
  {
    id: 'monero',
    title: 'Monero',
    scheme: 'ed25519 scalars mod ℓ · Keccak-256 · Monero Base58',
    symbols: ['XMR'],
    entropyBytes: 32,
    build(bytes) {
      const w = moneroWallet(bytes);
      return {
        keys: [
          { label: '25-word mnemonic seed', value: w.mnemonic, mnemonic: true, hint: 'Monero GUI / Feather / Cake Wallet → Restore from seed.' },
          { label: 'Private spend key', value: w.spendKey, hint: 'Alternative: restore from keys (address + view + spend key).' },
          { label: 'Private view key', value: w.viewKey, hint: 'Lets a wallet see incoming funds but not spend them.' },
        ],
        addresses: [{ symbols: ['XMR'], label: 'Monero primary address', value: w.address }],
        notes: ['When restoring, set the restore height to the print date so the wallet does not scan the whole chain.'],
      };
    },
  },
];

function draw(randomBytes, n) {
  const b = randomBytes(n);
  if (!(b instanceof Uint8Array) || b.length !== n) throw new Error(`random source must return ${n} bytes`);
  return b;
}

function drawKey(group, randomBytes) {
  if (!group.secp256k1) return draw(randomBytes, group.entropyBytes);
  for (let i = 0; i < MAX_SECP_ATTEMPTS; i++) {
    const k = draw(randomBytes, group.entropyBytes);
    if (secp256k1.utils.isValidSecretKey(k)) return k;
  }
  throw new Error('random source keeps producing invalid secp256k1 keys');
}

// randomBytes(n) -> Uint8Array; in the browser this is crypto.getRandomValues.
export function generateWallets(randomBytes, ids = GROUPS.map((g) => g.id)) {
  return GROUPS.filter((g) => ids.includes(g.id)).map((g) => {
    const { keys, addresses, notes } = g.build(drawKey(g, randomBytes));
    return { id: g.id, title: g.title, scheme: g.scheme, symbols: g.symbols, keys, addresses, notes };
  });
}
