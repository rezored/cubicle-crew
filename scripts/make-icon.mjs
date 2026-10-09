// Генерира build/icon.png (256x256) – пиксел-арт монитор, същият като иконата в трея.
// Пусни: node scripts/make-icon.mjs   (без външни пакети – собствен PNG енкодер с zlib)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const G = 32, K = 8, S = G * K; // мрежа 32x32 "арт пиксела", всеки 8x8 => 256x256
const px = new Uint8Array(S * S * 4);
const rect = (x, y, w, h, [r, g, b, a = 255]) => {
  for (let j = y * K; j < (y + h) * K; j++) for (let i = x * K; i < (x + w) * K; i++) {
    const o = (j * S + i) * 4; px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = a;
  }
};
const OUT = [23, 18, 31], GREEN = [74, 194, 107], HI = [150, 230, 170];
rect(1, 3, 30, 22, OUT);              // рамка
rect(3, 5, 26, 18, GREEN);            // екран
rect(3, 5, 26, 1, HI);
rect(5, 8, 3, 2, [255, 255, 255]); rect(9, 8, 8, 2, [230, 255, 230]);   // "код"
rect(7, 12, 12, 2, [200, 240, 210]); rect(20, 12, 4, 2, [255, 240, 160]);
rect(5, 16, 6, 2, [230, 255, 230]); rect(12, 16, 9, 2, [200, 240, 210]);
rect(5, 20, 2, 2, [255, 255, 255]);                                      // курсор
rect(13, 25, 6, 3, OUT); rect(8, 28, 16, 3, OUT); rect(9, 28, 14, 1, [70, 62, 90]);

// --- PNG ---
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(S, 0); ihdr.writeUInt32BE(S, 4); ihdr[8] = 8; ihdr[9] = 6; // 8 бита, RGBA
const raw = Buffer.alloc(S * (S * 4 + 1));
for (let y = 0; y < S; y++) { raw[y * (S * 4 + 1)] = 0; Buffer.from(px.buffer, y * S * 4, S * 4).copy(raw, y * (S * 4 + 1) + 1); }
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'build', 'icon.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, png);
console.log('icon:', out, png.length, 'bytes');
