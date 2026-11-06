/**
 * Build-time asset generator. Creates the local PWA icons and favicon from a
 * small vector-like renderer (no image dependencies).
 *
 * Usage: node tools/build-assets.mjs
 */
import { writeFile, mkdir } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const outDir = path.join(root, 'assets', 'icons');
await mkdir(outDir, { recursive: true });

const PURPLE_A = [124, 58, 237];
const PURPLE_B = [168, 85, 247];
const WHITE = [255, 255, 255];

function mix(a, b, t) {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t)
  ];
}

function insideRoundedRect(x, y, rx, ry, w, h, r) {
  if (x < rx || x > rx + w || y < ry || y > ry + h) return false;
  const cx = Math.max(rx + r, Math.min(x, rx + w - r));
  const cy = Math.max(ry + r, Math.min(y, ry + h - r));
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function makeQrRenderer(size, { maskable = false } = {}) {
  const safeScale = maskable ? 0.58 : 0.66;
  const glyphSize = size * safeScale;
  const moduleCount = 21;
  const module = glyphSize / moduleCount;
  const gx = (size - glyphSize) / 2;
  const gy = (size - glyphSize) / 2;
  const radius = module * 0.22;

  const finders = [
    [0, 0],
    [moduleCount - 7, 0],
    [0, moduleCount - 7]
  ];

  const dataDots = [
    [8, 1], [10, 1], [12, 1], [8, 3], [12, 3], [9, 5], [11, 5],
    [1, 8], [3, 8], [5, 8], [8, 8], [10, 8], [12, 8], [14, 8], [16, 8], [18, 8],
    [1, 10], [5, 10], [9, 10], [11, 10], [13, 10], [17, 10], [19, 10],
    [1, 12], [3, 12], [7, 12], [9, 12], [11, 12], [15, 12], [19, 12],
    [8, 14], [10, 14], [12, 14], [14, 14], [16, 14], [18, 14],
    [8, 16], [11, 16], [13, 16], [15, 16], [19, 16],
    [8, 18], [10, 18], [12, 18], [16, 18], [18, 18],
    [8, 20], [13, 20], [15, 20], [17, 20], [19, 20],
    [20, 8], [20, 11], [20, 13], [20, 17], [20, 19]
  ];

  function sample(x, y) {
    // background
    let color = null;
    const bgRadius = maskable ? 0 : size * 0.225;
    const bgInset = maskable ? 0 : size * 0.018;
    if (maskable || insideRoundedRect(x, y, bgInset, bgInset, size - 2 * bgInset, size - 2 * bgInset, bgRadius)) {
      const t = Math.max(0, Math.min(1, (x / size) * 0.35 + (y / size) * 0.65));
      color = mix(PURPLE_A, PURPLE_B, t);
    }
    if (!color) return null;

    const mx = (x - gx) / module;
    const my = (y - gy) / module;
    if (mx < 0 || my < 0 || mx >= moduleCount || my >= moduleCount) return color;

    // finder patterns: 7-module white ring + 3-module white centre
    for (const [fx, fy] of finders) {
      const lx = mx - fx;
      const ly = my - fy;
      if (lx >= 0 && lx < 7 && ly >= 0 && ly < 7) {
        if (insideRoundedRect(lx, ly, 0, 0, 7, 7, 1.2)) {
          const inHole = lx >= 1 && lx <= 6 && ly >= 1 && ly <= 6;
          const inCenter = lx >= 2 && lx <= 5 && ly >= 2 && ly <= 5;
          if (!inHole || inCenter) return WHITE;
          return color;
        }
      }
    }

    // data modules
    for (const [dx, dy] of dataDots) {
      if (insideRoundedRect(mx, my, dx, dy, 1, 1, radius / module)) return WHITE;
    }

    return color;
  }

  const SS = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS;
          const py = y + (sy + 0.5) / SS;
          const c = sample(px, py);
          if (c) { r += c[0]; g += c[1]; b += c[2]; a += 255; }
        }
      }
      const n = SS * SS;
      const i = (y * size + x) * 4;
      if (a === 0) {
        pixels[i] = 0; pixels[i + 1] = 0; pixels[i + 2] = 0; pixels[i + 3] = 0;
      } else {
        const cover = a / (255 * n);
        pixels[i] = Math.round(r / (n * cover));
        pixels[i + 1] = Math.round(g / (n * cover));
        pixels[i + 2] = Math.round(b / (n * cover));
        pixels[i + 3] = Math.round(a / n);
      }
    }
  }
  return pixels;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePng(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="QR Studio">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7c3aed"/>
      <stop offset="1" stop-color="#a855f7"/>
    </linearGradient>
  </defs>
  <rect x="9" y="9" width="494" height="494" rx="116" fill="url(#g)"/>
  <g fill="#fff">
    <path d="M102 102h102v102H102Zm18 18v66h66v-66Z"/>
    <path d="M308 102h102v102H308Zm18 18v66h66v-66Z"/>
    <path d="M102 308h102v102H102Zm18 18v66h66v-66Z"/>
    <rect x="195" y="195" width="34" height="34" rx="8"/>
    <rect x="246" y="195" width="22" height="22" rx="6"/>
    <rect x="283" y="195" width="34" height="34" rx="8"/>
    <rect x="332" y="195" width="34" height="34" rx="8"/>
    <rect x="195" y="246" width="22" height="22" rx="6"/>
    <rect x="232" y="246" width="34" height="34" rx="8"/>
    <rect x="283" y="246" width="22" height="22" rx="6"/>
    <rect x="332" y="246" width="34" height="34" rx="8"/>
    <rect x="195" y="283" width="34" height="34" rx="8"/>
    <rect x="246" y="283" width="34" height="34" rx="8"/>
    <rect x="298" y="283" width="22" height="22" rx="6"/>
    <rect x="332" y="283" width="34" height="34" rx="8"/>
    <rect x="195" y="332" width="22" height="22" rx="6"/>
    <rect x="232" y="332" width="34" height="34" rx="8"/>
    <rect x="283" y="332" width="22" height="22" rx="6"/>
    <rect x="332" y="332" width="34" height="34" rx="8"/>
    <rect x="195" y="378" width="34" height="34" rx="8"/>
    <rect x="246" y="378" width="22" height="22" rx="6"/>
    <rect x="283" y="378" width="34" height="34" rx="8"/>
    <rect x="332" y="378" width="34" height="34" rx="8"/>
  </g>
</svg>`;

const markSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="QR Studio">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7c3aed"/><stop offset="1" stop-color="#a855f7"/></linearGradient></defs>
  <rect width="64" height="64" rx="15" fill="url(#g)"/>
  <g fill="#fff"><path d="M13 13h14v14H13Zm3 3v8h8v-8Z"/><path d="M37 13h14v14H37Zm3 3v8h8v-8Z"/><path d="M13 37h14v14H13Zm3 3v8h8v-8Z"/><rect x="31" y="31" width="5" height="5" rx="1"/><rect x="40" y="31" width="4" height="4" rx="1"/><rect x="48" y="31" width="5" height="5" rx="1"/><rect x="31" y="40" width="4" height="4" rx="1"/><rect x="40" y="40" width="5" height="5" rx="1"/><rect x="48" y="40" width="4" height="4" rx="1"/><rect x="31" y="48" width="5" height="5" rx="1"/><rect x="40" y="48" width="4" height="4" rx="1"/><rect x="48" y="48" width="5" height="5" rx="1"/></g>
</svg>`;

const sizes = [16, 32, 180, 192, 512];
for (const size of sizes) {
  const png = encodePng(size, makeQrRenderer(size));
  await writeFile(path.join(outDir, `icon-${size}.png`), png);
}
await writeFile(path.join(outDir, 'icon-maskable-512.png'), encodePng(512, makeQrRenderer(512, { maskable: true })));
await writeFile(path.join(outDir, 'icon.svg'), iconSvg);
await writeFile(path.join(outDir, 'logo.svg'), markSvg);
await writeFile(path.join(outDir, 'icon-maskable.svg'), iconSvg);

console.log('Generated local icons in assets/icons');
