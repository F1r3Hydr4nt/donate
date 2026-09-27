# Offline paper wallet generator

This single page makes printable paper wallets (keys, addresses and QR codes) for the CoinMarketCap top 17.

| Chain | Ticker | Address|
|---|---|---|
| Bitcoin — Satoshi's Vision | BSV | `1QHTNWbDZX3GijaLdBhLyNCZEPnd6rpPWX` |
| Bitcoin SegWit | BTC | `bc1qlancljl8q4tuc0s8fncs5syz50830e7z9durnr` |
| Bitcoin Cash | BCH | `bitcoincash:qrlk0r7tuuz40np7qax0zzjqs23u79l8cgh2uzr7dz` |
| Dogecoin | DOGE | `DURYumXrrvwZFjkwMmguX8NA7XWvTSsoFd` |
| Zcash (transparent) | ZEC | `t1hA4Nr1MXqpsKNdEZcWU7BJUV3yhu75XNj` |
| EVM (Ethereum / BNB Smart Chain / HyperEVM) | ETH, USDT, USDC, BNB, LINK, LEO, HYPE | `0x63912d48e283636cAbbc5eb9B0227eC81274CAFa` |
| TRON | TRX, USDT (TRC-20) | `TK3fp7ms7TXdRTw7TBrUjDSmcfuSoUjREd` |
| XRP Ledger | XRP | `rNtAZxP2xhSMr7UXXAqc6wr6UzvxPTFGz3` |
| Cardano | ADA | `addr1q9a6s8z2kzp7rnpfzr4yzzln39nmrtk75u9ffv86wmlmc2mcu5lfh0yw79rg59z2w2ph2nmxrvf7gcc3e3hkunujtpmsvlwksg` |
| Solana | SOL | `5a7aJqji9gT1VCtreR8A4jcHy5NUnjoYhb5QuKU4BWHK` |
| Stellar | XLM | `GBB6UWITRDZH3NGHA3S2WNXEEMMSWZ36V53JI5TLYL6PMDUOQ5PONXS7` |
| Monero | XMR | `4AiLqDLZWPo8C6hUpyMCLAiyuCZteKU3L26usTg55hgtf7D7MMT5hd6hQrRVKRAzNo7LETvW3RAttSgj46bz9UBT71dFPnC` |

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
Every generated wallet prints on a single A4 or Letter page. On paper, the addresses sit in three fixed columns and the keys in two, and each group always goes in the same column.
The e2e tests print to PDF at both sizes and check for exactly one page. They print once with the default fonts and once with Tor Browser's font widths (Arial/Courier New stand in for its bundled Arimo/Cousine), filling every recovery word with the longest word in the lists and requiring 10mm to spare. A separate check fails if anything is wider than its printed column.

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
