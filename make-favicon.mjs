// Generate public/favicon.ico from public/og.png (PNG-embedded ICO, supported by all modern browsers).
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const png = readFileSync(join(root, 'public', 'og.png'));

// PNG: width/height are big-endian uint32 at byte offsets 16 and 20.
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);

const buf = Buffer.alloc(22 + png.length);
// ICONDIR
buf.writeUInt16LE(0, 0);      // reserved
buf.writeUInt16LE(1, 2);      // type = icon
buf.writeUInt16LE(1, 4);      // count
// ICONDIRENTRY
buf.writeUInt8(w >= 256 ? 0 : w, 6);   // width
buf.writeUInt8(h >= 256 ? 0 : h, 7);   // height
buf.writeUInt8(0, 8);                  // color count
buf.writeUInt8(0, 9);                  // reserved
buf.writeUInt16LE(1, 10);              // planes
buf.writeUInt16LE(32, 12);             // bit count
buf.writeUInt32LE(png.length, 14);     // bytes in resource
buf.writeUInt32LE(22, 18);             // image data offset
png.copy(buf, 22);

writeFileSync(join(root, 'public', 'favicon.ico'), buf);
console.log('og.png is ' + w + 'x' + h + '; wrote favicon.ico (' + buf.length + ' bytes)');
