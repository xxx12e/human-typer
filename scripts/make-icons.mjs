#!/usr/bin/env node
// 生成 icons/icon{16,32,48,128}.png。纯 Node 实现，不依赖任何图像库。
import fs from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(root, 'icons');
const SIZES = [16, 32, 48, 128];
const SCALE = 8; // 超采样倍数，缩小时得到平滑边缘

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}
const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
};
function png(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

const mix = (a, b, t) => Math.round(a + (b - a) * t);
function render(size) {
  const scale = SCALE;
  const width = size * scale;
  const pixels = Buffer.alloc(width * width * 4);
  const radius = width * 0.22;
  const insideRounded = (x, y, left, top, right, bottom, r) => {
    if (x < left || x > right || y < top || y > bottom) return false;
    const cx = Math.min(Math.max(x, left + r), right - r);
    const cy = Math.min(Math.max(y, top + r), bottom - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const bar = (x, y, left, top, width_, height, r) =>
    insideRounded(x, y, left, top, left + width_, top + height, r);

  const pad = width * 0.14;
  const lineHeight = width * 0.105;
  const gap = width * 0.115;
  const bars = [
    { y: width * 0.30, w: width * 0.52 },
    { y: width * 0.30 + lineHeight + gap, w: width * 0.60 },
    { y: width * 0.30 + (lineHeight + gap) * 2, w: width * 0.36 }
  ];
  for (let y = 0; y < width; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (!insideRounded(x + 0.5, y + 0.5, 0, 0, width, width, radius)) continue;
      // 背景：从上到下的深蓝渐变
      const t = y / width;
      pixels[offset] = mix(0x2a, 0x12, t);
      pixels[offset + 1] = mix(0x5f, 0x2c, t);
      pixels[offset + 2] = mix(0xd8, 0x74, t);
      pixels[offset + 3] = 255;
      // 文字条
      let painted = false;
      for (const item of bars) {
        if (bar(x + 0.5, y + 0.5, pad, item.y, item.w, lineHeight, lineHeight / 2)) painted = true;
      }
      if (painted) {
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
      }
      // 光标：第二条线末尾的橙色竖条
      const caretX = pad + bars[1].w + width * 0.045;
      const caretY = bars[1].y - width * 0.01;
      if (bar(x + 0.5, y + 0.5, caretX, caretY, width * 0.045, lineHeight + width * 0.02, width * 0.022)) {
        pixels[offset] = 0xff;
        pixels[offset + 1] = 0xa8;
        pixels[offset + 2] = 0x3d;
      }
    }
  }
  // 缩回目标尺寸（盒式滤波，带 alpha 预乘近似）
  const out = Buffer.alloc(size * size * 4);
  const area = scale * scale;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < scale; sy += 1) {
        for (let sx = 0; sx < scale; sx += 1) {
          const offset = ((y * scale + sy) * width + (x * scale + sx)) * 4;
          const alpha = pixels[offset + 3] / 255;
          r += pixels[offset] * alpha;
          g += pixels[offset + 1] * alpha;
          b += pixels[offset + 2] * alpha;
          a += pixels[offset + 3];
        }
      }
      const offset = (y * size + x) * 4;
      const alpha = a / area;
      const weight = alpha > 0 ? a / 255 : 1;
      out[offset] = Math.round(r / weight);
      out[offset + 1] = Math.round(g / weight);
      out[offset + 2] = Math.round(b / weight);
      out[offset + 3] = Math.round(alpha);
    }
  }
  return png(size, size, out);
}

fs.mkdirSync(OUT, { recursive: true });
for (const size of SIZES) {
  const file = path.join(OUT, `icon${size}.png`);
  fs.writeFileSync(file, render(size));
  console.log(`icons/icon${size}.png  ${fs.statSync(file).size} B`);
}
