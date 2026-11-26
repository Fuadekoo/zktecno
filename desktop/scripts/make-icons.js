/**
 * Draws the app icon (green rounded square with a white clock) as PNG files, with no extra tools:
 *   build/icon.png   256x256  app + installer icon (electron-builder makes the .ico from it)
 *   assets/tray.png   64x64   tray icon (scaled down at runtime)
 * Run: node scripts/make-icons.js
 */
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x, y, size);
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** Coverage (0..1) of the shape at a point, 4x4 supersampled for smooth edges. */
function sample(x, y, size, inside) {
  let hit = 0;
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) if (inside((x + (i + 0.5) / 4) / size, (y + (j + 0.5) / 4) / size)) hit++;
  return hit / 16;
}
const roundedSquare = (u, v) => {
  const r = 0.2, m = 0.04;
  const qx = Math.max(Math.abs(u - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(v - 0.5) - (0.5 - m - r), 0);
  return Math.hypot(qx, qy) <= r;
};
/** Distance from point to segment, for the clock hands. */
function seg(u, v, ax, ay, bx, by) {
  const px = u - ax, py = v - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - t * dx, py - t * dy);
}
const clock = (u, v) => {
  const d = Math.hypot(u - 0.5, v - 0.5);
  const ring = d >= 0.25 && d <= 0.31;
  const hourHand = seg(u, v, 0.5, 0.5, 0.5, 0.33) <= 0.035;
  const minuteHand = seg(u, v, 0.5, 0.5, 0.63, 0.58) <= 0.035;
  const ticks = [0, 90, 180, 270].some((deg) => {
    const a = (deg * Math.PI) / 180;
    return seg(u, v, 0.5 + Math.sin(a) * 0.36, 0.5 - Math.cos(a) * 0.36, 0.5 + Math.sin(a) * 0.4, 0.5 - Math.cos(a) * 0.4) <= 0.022;
  });
  return ring || hourHand || minuteHand || ticks;
};

function icon(x, y, size) {
  const bg = sample(x, y, size, roundedSquare);
  if (!bg) return [0, 0, 0, 0];
  const fg = sample(x, y, size, clock);
  const green = [22, 163, 74];
  const c = green.map((g) => Math.round(g + (255 - g) * fg));
  return [...c, Math.round(255 * bg)];
}

const root = path.join(__dirname, '..');
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
fs.writeFileSync(path.join(root, 'build', 'icon.png'), png(256, icon));
fs.writeFileSync(path.join(root, 'assets', 'tray.png'), png(64, icon));
console.log('Wrote build/icon.png (256) and assets/tray.png (64)');
