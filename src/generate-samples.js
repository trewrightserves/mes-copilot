'use strict';
/*
 * Generates the bundled Vision QC sample photos: simple, clearly synthetic
 * renderings of the BRK-2041 mounting bracket (flat plate, four punched
 * holes, one formed bend) — one known-good and five seeded-defect variants.
 * Pure Node (zlib PNG encoder), deterministic, no external assets.
 * Output: ../public/samples/*.png
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'samples');
const W = 640, H = 480;

// --- minimal PNG encoder ---
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function encodePng(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc(h * (1 + w * 4));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 4)] = 0;
    rgba.copy(raw, y * (1 + w * 4) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// --- tiny rasterizer ---
function canvas(bg) {
  const buf = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { buf[i * 4] = bg[0]; buf[i * 4 + 1] = bg[1]; buf[i * 4 + 2] = bg[2]; buf[i * 4 + 3] = 255; }
  return buf;
}
function px(buf, x, y, c) {
  x = Math.round(x); y = Math.round(y);
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255;
}
function rect(buf, x0, y0, x1, y1, c) { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) px(buf, x, y, c); }
function circle(buf, cx, cy, r, c) { for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { const dx = x - cx, dy = y - cy; if (dx * dx + dy * dy <= r * r) px(buf, x, y, c); } }
function line(buf, x0, y0, x1, y1, c, thick = 2) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let s = 0; s <= steps; s++) {
    const x = x0 + (x1 - x0) * (s / steps), y = y0 + (y1 - y0) * (s / steps);
    for (let a = -thick; a <= thick; a++) for (let b = -thick; b <= thick; b++) px(buf, x + a, y + b, c);
  }
}
// deterministic pseudo-random from a seed string (for scratch jitter etc.)
function rngFrom(seed) { let a = 0; for (const ch of seed) a = (a * 31 + ch.charCodeAt(0)) >>> 0; return () => { a = (a * 1103515245 + 12345) >>> 0; return a / 4294967296; }; }

const STEEL = [168, 172, 178], STEEL_DARK = [128, 133, 140], EDGE = [92, 96, 102], HOLE = [38, 40, 44], HOLE_RIM = [210, 213, 218];
const BENCH = [74, 78, 84], SHADOW = [52, 55, 60];

function drawBracket(variant) {
  const buf = canvas(BENCH);
  // bench grid lines
  for (let x = 0; x < W; x += 40) line(buf, x, 0, x, H, [82, 86, 92], 0);
  for (let y = 0; y < H; y += 40) line(buf, 0, y, W, y, [82, 86, 92], 0);
  // shadow + plate (with a formed-bend flange at the bottom)
  rect(buf, 118, 108, 528, 368, SHADOW);
  rect(buf, 110, 100, 520, 360, STEEL);
  rect(buf, 110, 100, 520, 360, STEEL); // base
  // brushed texture
  const trng = rngFrom('texture');
  for (let i = 0; i < 2600; i++) {
    const x = 112 + trng() * 406, y = 102 + trng() * 256;
    px(buf, x, y, trng() < 0.5 ? [178, 182, 188] : [158, 162, 168]);
  }
  // plate border + bend line + flange shading
  rect(buf, 110, 100, 520, 106, EDGE); rect(buf, 110, 354, 520, 360, EDGE);
  rect(buf, 110, 100, 116, 360, EDGE); rect(buf, 514, 100, 520, 360, EDGE);
  line(buf, 110, 318, 520, 318, STEEL_DARK, 2);
  rect(buf, 110, 322, 520, 354, [148, 152, 158]);
  const holes = [[180, 170], [450, 170], [180, 280], [450, 280]];
  const drawHole = ([hx, hy]) => { circle(buf, hx, hy, 21, HOLE_RIM); circle(buf, hx, hy, 17, HOLE); };
  if (variant === 'hole-missing') {
    holes.slice(0, 3).forEach(drawHole);
    circle(buf, 450, 280, 6, STEEL_DARK); // unpunched dimple where the 4th hole belongs
  } else {
    holes.forEach(drawHole);
  }
  if (variant === 'scratch') {
    const srng = rngFrom('scratch');
    let x = 150, y = 140;
    for (let s = 0; s < 26; s++) { const nx = x + 13 + srng() * 5, ny = y + 5 + srng() * 4; line(buf, x, y, nx, ny, [226, 229, 233], 1); x = nx; y = ny; }
  }
  if (variant === 'dent') {
    for (let r = 30; r > 4; r -= 4) circle(buf, 330, 235, r, [138, 142, 148]);
    circle(buf, 330, 235, 9, [112, 116, 122]);
  }
  if (variant === 'crack') {
    const crng = rngFrom('crack');
    let x = 300, y = 318;
    for (let s = 0; s < 14; s++) { const nx = x + (crng() - 0.3) * 22, ny = y - 12 - crng() * 8; line(buf, x, y, nx, ny, [30, 31, 35], 1); x = nx; y = ny; }
  }
  if (variant === 'burr') {
    const brng = rngFrom('burr');
    for (let x = 116; x < 516; x += 5) {
      const len = 4 + brng() * 9;
      line(buf, x, 100, x + (brng() - 0.5) * 4, 100 - len, [196, 199, 205], 1);
    }
  }
  // label strip (clearly synthetic sample tag)
  rect(buf, 110, 372, 520, 402, [30, 32, 36]);
  return buf;
}

const VARIANTS = [
  ['brk-2041-good', 'good'],
  ['brk-2041-scratch', 'scratch'],
  ['brk-2041-dent', 'dent'],
  ['brk-2041-hole-missing', 'hole-missing'],
  ['brk-2041-crack', 'crack'],
  ['brk-2041-burr', 'burr']
];
fs.mkdirSync(OUT, { recursive: true });
for (const [id, variant] of VARIANTS) {
  fs.writeFileSync(path.join(OUT, `${id}.png`), encodePng(drawBracket(variant), W, H));
  console.log(`wrote public/samples/${id}.png`);
}
