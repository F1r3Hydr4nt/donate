import { encodeQR } from '@paulmillr/qr';

// Boolean module matrix including the 4-module quiet zone required by the QR spec.
export function qrMatrix(text) {
  return encodeQR(text, 'raw', { ecc: 'medium', border: 4 });
}

// Compact single-path SVG (one horizontal run per segment) that prints crisply at any size.
export function qrSvg(text) {
  const m = qrMatrix(text);
  let d = '';
  m.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (!row[x]) continue;
      const start = x;
      while (row[x + 1]) x++;
      d += `M${start} ${y}h${x - start + 1}v1h-${x - start + 1}z`;
    }
  });
  const n = m.length;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="#fff"/><path fill="#000" d="${d}"/></svg>`;
}
