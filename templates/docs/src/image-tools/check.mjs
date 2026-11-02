// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Picture checks of the docs website (rules in rules.mjs), run by images.mjs on every build,
// or alone: `node src/image-tools/check.mjs` (exit 1 when there are errors).
// - Errors (the build stops): an original picture in src/ longer than 2000 px or heavier than
//   500 KB -> `npm run images` fixes it; an SVG over 200 KB.
// - Warnings (printed only): two identical pictures, a picture used nowhere (only named in a
//   comment counts as unused), a picture in public/ (Astro does not optimise those).
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_BYTES, MAX_SIDE, MAX_SVG_BYTES, PICTURE, findRefs, sitePictures, userFiles, walk, withoutComments } from './rules.mjs';

const kb = (n) => `${Math.round(n / 1000)} KB`;

/** checkPictures(docsDir) -> { errors, warnings, count } (lists of sentences). */
export async function checkPictures(docsDir) {
  const { default: sharp } = await import('sharp');
  const errors = [], warnings = [];
  const name = (f) => relative(docsDir, f);
  const { raster, svg } = sitePictures(docsDir);
  const users = userFiles(docsDir).map((u) => ({ ...u, text: withoutComments(u.text, u.path) }));
  const seen = new Map();

  for (const file of [...raster, ...svg]) {
    const bytes = statSync(file).size;
    if (raster.includes(file)) {
      const meta = await sharp(file).metadata();
      const w = meta.autoOrient?.width ?? meta.width, h = meta.autoOrient?.height ?? meta.height;
      if (Math.max(w, h) > MAX_SIDE) errors.push(`${name(file)}: ${w}x${h} px (max ${MAX_SIDE} px) -> run: npm run images`);
      if (bytes > MAX_BYTES) errors.push(`${name(file)}: ${kb(bytes)} (max ${kb(MAX_BYTES)}) -> run: npm run images`);
    } else if (bytes > MAX_SVG_BYTES) {
      errors.push(`${name(file)}: ${kb(bytes)} SVG (max ${kb(MAX_SVG_BYTES)}): simplify the drawing`);
    }
    const hash = createHash('sha256').update(readFileSync(file)).digest('hex');
    if (seen.has(hash)) warnings.push(`${name(file)}: same picture as ${name(seen.get(hash))}: use that one and delete this file`);
    else seen.set(hash, file);
    if (!users.some((u) => findRefs(u.text, u.path, file, docsDir).length)) {
      warnings.push(`${name(file)}: used nowhere: delete it (git history keeps it)`);
    }
  }
  for (const file of walk(join(docsDir, 'public')).filter((f) => PICTURE.test(f))) {
    if (relative(docsDir, file) === join('public', basename(file)) && /^favicon\./i.test(basename(file))) continue;
    warnings.push(`${name(file)}: pictures belong in src/ (Astro makes them light and responsive there, not in public/)`);
  }
  return { errors, warnings, count: raster.length + svg.length };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { errors, warnings, count } = await checkPictures(process.cwd());
  for (const w of warnings) console.warn(`  [!] ${w}`);
  for (const e of errors) console.error(`  [x] ${e}`);
  if (errors.length) {
    console.error(`${errors.length} picture problem(s): the docs website will not build until they are fixed.`);
    process.exit(1);
  }
  console.log(`  ok (${count} pictures${warnings.length ? `, ${warnings.length} warning(s)` : ''})`);
}
