# Offline paper wallet generator

This single page makes printable paper wallets (keys, addresses and QR codes) for the CoinMarketCap top 17.
The output is `dist/paper-wallet.zip`: unzip it on an offline computer and open `index.html`. You don't need a server or network.
The page is one self-contained file (script and styles inline), so it works however it is opened, including through the Tails file picker, which exposes only the file you pick.

| Group | Coins | Secret you print |
|---|---|---|
| Bitcoin family (secp256k1, HASH160) | BTC (bc1q + 1…), BCH (CashAddr), DOGE, ZEC (t1…) | WIF (BTC/BCH/ZEC), WIF (DOGE), hex |
| EVM + TRON (secp256k1, Keccak) | ETH, USDT, USDC, LINK, LEO (ERC-20), BNB (BSC), HYPE (HyperEVM), TRX | hex private key |
| ed25519 | SOL, XLM | Solana base58 secret, Stellar `S…` seed |
| XRP | XRP | `sEd…` family seed (ed25519) |
| Cardano | ADA | 24-word BIP-39 phrase (CIP-1852 base address) |
| Monero | XMR | 25-word seed + spend/view keys |

Each group gets its own fresh key from `crypto.getRandomValues`.

Only public addresses get QR codes. Every private key and seed is shown in full as plain text, split visually into 4-character chunks; copying still gives the unbroken string.
Nothing is blurred or hidden on screen.
This is on purpose: the keys are meant to be typed by hand into offline software to build and sign transaction blobs, which then move without cameras.
A QR code on a secret wouldn't help that workflow, and it's one more way to leak it.
The page lists every address and its QR code first, then every private key below a dashed line. Each half repeats the group titles, so you can match keys to addresses.
Every generated wallet prints on a single A4 or Letter page. The e2e test prints to PDF at both sizes and checks for exactly one page.

## Develop

```
npm ci
npm test        # node:test, cross-checked against reference libraries + headless Chrome e2e
npm run build   # -> dist/paper-wallet/ and dist/paper-wallet.zip (+ .sha256)
```

These runtime dependencies are bundled into the inline script in `index.html`: `@noble/curves`, `@noble/hashes`, `@scure/base`, `@scure/bip39`, `@paulmillr/qr`.
The other dev dependencies (bitcoinjs-lib, ethers, tronweb, @solana/web3.js, stellar-base, ripple-keypairs,
cardano-serialization-lib, monero-ts, jsqr) are only used by the tests, as independent sources of truth. They are never shipped.
`package.json` overrides pin patched versions of three of their transitive dependencies (`serialize-javascript`, `uuid`, `stream-json`), so `npm audit` is clean.

The build is reproducible. The zip is written by `scripts/build.mjs` itself, with a fixed entry order and one timestamp (`SOURCE_DATE_EPOCH` if set, else the last commit's time).
Building the same commit gives the same `paper-wallet.zip` SHA-256, so anyone can rebuild it and check it matches.
The page's Content-Security-Policy admits only its own inline script and stylesheet, each by SHA-256 hash. It allows no network access.

When the page loads it runs 18 known-answer checks plus an RNG sanity check. Generation stays disabled unless they all pass.
Each group's raw entropy is zeroed once its keys are derived. Monero entropy of 15·ℓ or more is redrawn rather than reduced, so the spend key is uniform mod ℓ.
The keys themselves are JavaScript strings, which can't be wiped, so close the browser when done.
