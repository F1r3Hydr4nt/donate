import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import jsQR from 'jsqr';

import { qrMatrix, qrSvg } from '../src/qr.js';
import { generateWallets } from '../src/groups.js';

// Rasterise the module matrix to RGBA and decode it with an independent decoder (jsQR).
// (@paulmillr/qr's own decoder fails on ~0.5% of valid codes, so it is not used here.)
function decodeMatrix(m, scale) {
  const size = m.length * scale;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++)
      if (m[Math.floor(y / scale)][Math.floor(x / scale)]) data.fill(0, (y * size + x) * 4, (y * size + x) * 4 + 3);
  return jsQR(data, size, size)?.data;
}

test('every generated key and address round-trips through a QR decoder', () => {
  for (let round = 0; round < 5; round++) {
    for (const w of generateWallets(randomBytes)) {
      for (const item of [...w.keys, ...w.addresses]) {
        const m = qrMatrix(item.value);
        for (const scale of [2, 4, 7]) assert.equal(decodeMatrix(m, scale), item.value, `${w.id}/${item.label} @${scale}x`);
      }
    }
  }
});

test('qrSvg produces a standalone SVG', () => {
  const svg = qrSvg('bitcoin');
  assert.match(svg, /^<svg[\s\S]*<\/svg>$/);
  assert.doesNotMatch(svg, /https?:\/\/(?!www\.w3\.org)/); // no external references
});

test('qrSvg draws exactly the modules of the matrix', () => {
  const text = 'bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4';
  const m = qrMatrix(text);
  const grid = m.map((row) => row.map(() => false));
  for (const [, x, y, w] of qrSvg(text).matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g))
    for (let i = 0; i < +w; i++) grid[+y][+x + i] = true;
  assert.deepEqual(grid, m);
});
