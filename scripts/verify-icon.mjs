#!/usr/bin/env node
// Measure an icon SVG and check it against KOAN's geometric contract.
//
//   node scripts/verify-icon.mjs <file.svg> [...]
//   node scripts/verify-icon.mjs --target=any     apps/web/public/koan.svg
//   node scripts/verify-icon.mjs --target=maskable apps/web/public/koan-maskable.svg
//   node scripts/verify-icon.mjs --target=mark     some-mark.svg
//
// The contract, in viewBox units of a 120 box:
//
//   any       the mark's ink occupies 72 x 72 centred on (60, 60)  — 60% of the box.
//             The field (rounded chip) is ignored: only the mark is measured.
//   maskable  the mark occupies 57.6 x 57.6 centred on (60, 60)    — 60% x 0.8,
//             the 0.8 being the maskable safe-zone factor, and every inked pixel
//             sits inside the safe circle of radius 48.
//   mark      a bare mark on a transparent field, checked as `any`.
//
// A mark may be narrower than tall (letters are), so the *larger* dimension is the
// invariant; the smaller one only has to stay centred.
//
// Rasterises with rsvg-convert and measures the real ink bounding box, so this
// verifies the shape as drawn — transforms, strokes, caps, joins and all —
// rather than trusting the numbers in the path data.

import { execFileSync } from "node:child_process";
import { inflateSync } from "node:zlib";
import { basename } from "node:path";

const SCALE = 10; // 120 viewBox units -> 1200 px. 0.1 unit resolution.
const BOX = 120;
const TARGETS = {
  any: { size: 72, safeRadius: null },
  maskable: { size: 57.6, safeRadius: 48 },
  mark: { size: 72, safeRadius: null },
};
const TOL = 0.15; // viewBox units. One rasterised pixel is 0.1.

// ── PNG decode (8-bit, non-interlaced — what rsvg-convert emits) ────────────
function decodePng(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error("not a PNG");
  let off = 8;
  let ihdr = null;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString("ascii", off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === "IHDR") {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colorType: data[9],
        interlace: data[12],
      };
    } else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    off += 12 + len;
  }
  if (!ihdr) throw new Error("no IHDR");
  if (ihdr.depth !== 8 || ihdr.interlace !== 0) {
    throw new Error(`unsupported PNG (depth ${ihdr.depth}, interlace ${ihdr.interlace})`);
  }
  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[ihdr.colorType];
  if (!channels) throw new Error(`unsupported colour type ${ihdr.colorType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const { width, height } = ihdr;
  const stride = width * channels;
  const out = Buffer.alloc(height * stride);

  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const cur = out.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      } else if (filter !== 0) throw new Error(`bad filter ${filter}`);
      cur[i] = v & 0xff;
    }
  }
  return { ...ihdr, channels, pixels: out };
}

// ── measure ────────────────────────────────────────────────────────────────
function inkBox(png) {
  const { width, height, channels, pixels } = png;
  const hasAlpha = channels === 2 || channels === 4;
  const at = (x, y) => (y * width + x) * channels;

  // The field is whatever sits at the midpoint of the top edge: transparent for a
  // bare mark, the chip colour for a finished icon. Ink is everything unlike it,
  // so a black chip is discounted and only the mark inside it gets measured.
  const f = at((width / 2) | 0, 1);
  const fieldOpaque = !hasAlpha || pixels[f + channels - 1] > 8;
  const field = [pixels[f], pixels[f + 1], pixels[f + 2]];
  const isInk = (i) => {
    const opaque = !hasAlpha || pixels[i + channels - 1] > 8;
    if (!fieldOpaque) return opaque;
    if (!opaque) return false;
    return Math.abs(pixels[i] - field[0]) +
      Math.abs(pixels[i + 1] - field[1]) +
      Math.abs(pixels[i + 2] - field[2]) > 24;
  };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let maxR2 = 0;
  const cx = (BOX / 2) * SCALE, cy = (BOX / 2) * SCALE;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = at(x, y);
      if (!isInk(i)) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
      const r2 = dx * dx + dy * dy;
      if (r2 > maxR2) maxR2 = r2;
    }
  }
  if (maxX < 0) throw new Error("no ink found");
  const u = (px) => px / SCALE;
  return {
    x0: u(minX), x1: u(maxX + 1), y0: u(minY), y1: u(maxY + 1),
    w: u(maxX + 1 - minX), h: u(maxY + 1 - minY),
    cx: u((minX + maxX + 1) / 2), cy: u((minY + maxY + 1) / 2),
    maxRadius: u(Math.sqrt(maxR2)),
  };
}

// ── report ─────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let target = "mark";
const files = [];
for (const a of args) {
  if (a.startsWith("--target=")) target = a.slice(9);
  else files.push(a);
}
if (!files.length) {
  console.error("usage: node scripts/verify-icon.mjs [--target=any|maskable|mark] <file.svg>...");
  process.exit(2);
}
const spec = TARGETS[target];
if (!spec) {
  console.error(`unknown target "${target}" (any | maskable | mark)`);
  process.exit(2);
}

const pad = (s, n) => String(s).padEnd(n);
const num = (n, d = 4) => n.toFixed(d).padStart(d + 4);
let failures = 0;

console.log(`target: ${target}  —  ${spec.size} x ${spec.size} centred on (60, 60)` +
  (spec.safeRadius ? `, safe radius ${spec.safeRadius}` : ""));
console.log("");

for (const file of files) {
  let box;
  try {
    const png = decodePng(
      execFileSync("rsvg-convert", ["-w", String(BOX * SCALE), "-h", String(BOX * SCALE), file],
        { maxBuffer: 1 << 28 }),
    );
    box = inkBox(png);
  } catch (err) {
    console.log(`${pad(basename(file), 26)} ERROR  ${err.message}`);
    failures++;
    continue;
  }

  const long = Math.max(box.w, box.h);
  const checks = [
    ["size", Math.abs(long - spec.size) <= TOL,
      `${num(box.w)} x ${num(box.h)}  (long side ${num(long)}, want ${spec.size})`],
    ["centre", Math.abs(box.cx - 60) <= TOL && Math.abs(box.cy - 60) <= TOL,
      `(${num(box.cx)}, ${num(box.cy)})  off by (${num(box.cx - 60)}, ${num(box.cy - 60)})`],
  ];
  if (spec.safeRadius !== null) {
    checks.push(["safe zone", box.maxRadius <= spec.safeRadius,
      `max radius ${num(box.maxRadius)}  (limit ${spec.safeRadius})`]);
  }

  const ok = checks.every(([, pass]) => pass);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${basename(file)}`);
  console.log(`      bbox   ${num(box.x0)} .. ${num(box.x1)}  x   ${num(box.y0)} .. ${num(box.y1)}  y`);
  for (const [name, pass, detail] of checks) {
    console.log(`      ${pass ? "ok  " : "BAD "} ${pad(name, 10)} ${detail}`);
  }
  console.log("");
}

process.exit(failures ? 1 : 0);
