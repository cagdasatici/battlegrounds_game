// Generates the original install icons (four-quadrant elemental ring on a dark field) as PNG files. No third-party art.
// Run: node ops/scripts/make-icons.mjs   Output: apps/client/public/icons/
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";

const out = new URL("../../apps/client/public/icons/", import.meta.url).pathname;
mkdirSync(out, { recursive: true });
const BG = [11, 17, 24];
const QUAD = [[240, 120, 50], [60, 150, 230], [90, 180, 90], [200, 220, 240]]; // original palette: ember, tide, moss, gale

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) { c = (crc ^ buf[n]) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, scale) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  const c = (size - 1) / 2, rOut = (size / 2) * scale, rIn = rOut * 0.45;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      const dx = x - c, dy = y - c, d = Math.hypot(dx, dy);
      let col = BG;
      if (d <= rOut && d >= rIn) col = QUAD[(dx >= 0 ? 1 : 0) + (dy >= 0 ? 2 : 0)];
      else if (d < rIn * 0.55) col = [245, 245, 245];
      const o = y * (size * 3 + 1) + 1 + x * 3;
      raw[o] = col[0]; raw[o + 1] = col[1]; raw[o + 2] = col[2];
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
for (const [name, size, scale] of [["icon-180.png", 180, 0.8], ["icon-192.png", 192, 0.8], ["icon-512.png", 512, 0.8], ["icon-maskable-512.png", 512, 0.55]]) {
  writeFileSync(out + name, png(size, scale));
}
writeFileSync(out + "icon.svg", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b1118"/><g fill="none" stroke-width="92"><path d="M256 256m-186 0a186 186 0 0 1 186-186" stroke="#f07832"/><path d="M256 70a186 186 0 0 1 186 186" stroke="#3c96e6"/><path d="M442 256a186 186 0 0 1-186 186" stroke="#5ab45a"/><path d="M256 442a186 186 0 0 1-186-186" stroke="#c8dcf0"/></g><circle cx="256" cy="256" r="50" fill="#f5f5f5"/></svg>\n`);
console.log("icons written");
