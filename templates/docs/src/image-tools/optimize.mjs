#!/usr/bin/env node
// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// `npm run images` (in the docs website's folder): makes every original picture in src/ follow
// the rules of rules.mjs: at most 2000 px on the longest side and at most 500 KB.
// - too long: resized to 2000 px (EXIF orientation applied first);
// - still too heavy: converted to WebP (quality 88, then lower, then smaller if needed;
//   transparency kept), the old file removed and every reference to it updated;
// - otherwise: a PNG is re-compressed (lossless) when that saves 5 %; JPEG and WebP pictures
//   that follow the rules are left alone (each re-encoding loses a little quality).
// SVG files are not changed (the build only checks their weight). Safe to run again.
import sharp from 'sharp';
import { existsSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { MAX_BYTES, MAX_SIDE, RASTER, renameRefs, sitePictures, userFiles } from './rules.mjs';

const docsDir = process.cwd();
const kb = (n) => `${Math.round(n / 1000)} KB`;
const name = (f) => relative(docsDir, f);
const users = userFiles(docsDir);
let changed = 0;
let failed = 0;

async function encode(file, format, quality, maxSide = MAX_SIDE) {
  const meta = await sharp(file).metadata();
  let img = sharp(file, { animated: meta.format === 'gif' || meta.format === 'webp' }).rotate();
  const w = meta.autoOrient?.width ?? meta.width;
  const h = meta.autoOrient?.height ?? meta.height;
  if (Math.max(w, h) > maxSide) img = img.resize(w >= h ? { width: maxSide } : { height: maxSide });
  if (format === 'jpeg') img = img.jpeg({ quality: quality ?? 85, mozjpeg: true });
  else if (format === 'png') img = img.png({ compressionLevel: 9, adaptiveFiltering: true, effort: 10 });
  else if (format === 'gif') img = img.gif({ effort: 10 });
  else img = img.webp({ quality: quality ?? 88, effort: 6 });
  return img.toBuffer();
}

if (!existsSync('package.json') || !existsSync('src')) {
  console.error('Run this in the docs website folder (the one with package.json and src/): npm run images');
  process.exit(2);
}

for (const file of sitePictures(docsDir).raster) {
  const before = statSync(file).size;
  const meta = await sharp(file).metadata();
  const w = meta.autoOrient?.width ?? meta.width;
  const h = meta.autoOrient?.height ?? meta.height;
  const tooLong = Math.max(w, h) > MAX_SIDE;
  const format = ['jpeg', 'png', 'gif'].includes(meta.format) ? meta.format : 'webp';
  if (!tooLong && before <= MAX_BYTES && format !== 'png') continue;

  // 1. Same format, resized if needed
  let data = await encode(file, format);
  if (data.length <= MAX_BYTES && (tooLong || data.length < before * 0.95)) {
    writeFileSync(file, data);
    console.log(`  ${name(file)}: ${kb(before)} -> ${kb(data.length)}${tooLong ? ' (resized)' : ''}`);
    changed++;
    continue;
  }
  if (data.length <= MAX_BYTES || (before <= MAX_BYTES && !tooLong)) continue; // already fine

  // 2. Too heavy: WebP, lowering the quality step by step, then the size if really needed
  let side = MAX_SIDE;
  search: for (side of [MAX_SIDE, 1600, 1200]) {
    for (const quality of [88, 80, 72]) {
      data = await encode(file, 'webp', quality, side);
      if (data.length <= MAX_BYTES) break search;
    }
  }
  if (data.length > MAX_BYTES) {
    console.error(`  ${name(file)}: still ${kb(data.length)} as a 1200 px WebP: crop it or pick a simpler picture`);
    failed++;
    continue;
  }
  const target = file.replace(RASTER, '.webp');
  if (target !== file && existsSync(target)) {
    console.error(`  ${name(file)}: ${name(target)} already exists, rename one of them first`);
    failed++;
    continue;
  }
  writeFileSync(target, data);
  if (target !== file) {
    unlinkSync(file);
    for (const user of users) {
      const text = renameRefs(user.text, user.path, file, target, docsDir);
      if (text === user.text) continue;
      user.text = text;
      writeFileSync(user.path, text);
      console.log(`    reference updated in ${name(user.path)}`);
    }
  }
  const smaller = side < MAX_SIDE ? ` (reduced to ${side} px to fit)` : tooLong ? ' (resized)' : '';
  console.log(`  ${name(file)}: ${kb(before)} -> ${name(target)} ${kb(data.length)}${smaller}`);
  changed++;
}

if (changed) console.log(`${changed} picture(s) optimised.`);
if (failed) {
  console.error(`${failed} picture(s) could not be fixed automatically (see above).`);
  process.exit(1);
}
if (!changed) console.log('All pictures already follow the rules.');
