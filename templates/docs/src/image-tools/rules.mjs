// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Picture rules of the docs website, shared by check.mjs (the build checks them) and
// optimize.mjs (`npm run images` fixes them). Files only: no network, no sharp here (so the
// agent kit's tests can check these functions without installing anything).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

export const MAX_SIDE = 2000; // px, longest side of an original picture
export const MAX_BYTES = 500_000; // an original raster picture (PNG, JPEG, WebP, GIF, AVIF)
export const MAX_SVG_BYTES = 200_000;
export const BREAKPOINTS = [400, 800, 1200, 1600, 2000]; // widths built for each picture (srcset)
export const RASTER = /\.(png|jpe?g|webp|gif|avif)$/i;
export const PICTURE = /\.(png|jpe?g|webp|gif|avif|svg)$/i;
// Files that may use a picture: everything in src/ with these endings, and the Astro config
const USER = /\.(mdx?|markdoc|astro|css|ts|tsx|js|mjs|jsx|json|ya?ml)$/i;
const CONFIGS = ['astro.config.mjs', 'astro.config.ts', 'astro.config.js'];
const SKIP = new Set(['node_modules', 'dist', '.astro', '.git']);

/** Every file under dir (none when dir is missing), without node_modules, dist and dot folders. */
export function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.isDirectory()) return SKIP.has(e.name) || e.name.startsWith('.') ? [] : walk(join(dir, e.name));
    return e.isFile() ? [join(dir, e.name)] : [];
  });
}

/** The original pictures of the site: { raster, svg } paths under src/. */
export function sitePictures(docsDir) {
  const all = walk(join(docsDir, 'src')).filter((f) => PICTURE.test(f));
  return { raster: all.filter((f) => RASTER.test(f)), svg: all.filter((f) => !RASTER.test(f)) };
}

/** Files that may use pictures, as { path, text } (text read now). */
export function userFiles(docsDir) {
  return [...walk(join(docsDir, 'src')).filter((f) => USER.test(f)), ...CONFIGS.map((c) => join(docsDir, c))]
    .filter((path) => existsSync(path))
    .map((path) => ({ path, text: readFileSync(path, 'utf8') }));
}

// Text without HTML and MDX comments (and block comments in code files, not in pages):
// a picture only named in a comment is not used.
export function withoutComments(text, path = '') {
  const out = text.replace(/<!--[\s\S]*?-->/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
  return /\.(mdx?|markdoc)$/i.test(path) ? out : out.replace(/\/\*[\s\S]*?\*\//g, '');
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// A path-like word ending with the picture's file name (then a quote, bracket, space, ? or #)
const refPattern = (name) => new RegExp(`(?<=^|[\\s'"\`(<\\[{=,:])([^\\s'"\`()<>\\[\\]{}=,]*${escape(name)})(?=$|[\\s'"\`)?#>\\]},])`, 'gm');

// Where a written path points: relative to the file using it, or /src/... from the site's folder.
// null for web addresses and /... paths (those are public/ files, not originals).
function target(ref, fromFile, docsDir) {
  if (/^[a-z][a-z0-9+.-]*:/i.test(ref)) return null;
  if (ref.startsWith('/src/')) return resolve(docsDir, '.' + ref);
  if (ref.startsWith('/')) return null;
  return resolve(dirname(fromFile), ref);
}

/** The references in `text` (from file `fromFile`) that point to `picture`. */
export function findRefs(text, fromFile, picture, docsDir) {
  const want = resolve(picture);
  return [...text.matchAll(refPattern(basename(picture)))]
    .map((m) => m[1])
    .filter((ref) => target(ref, fromFile, docsDir) === want);
}

/** `text` with every reference to `picture` renamed to `newPicture` (same folder). */
export function renameRefs(text, fromFile, picture, newPicture, docsDir) {
  const want = resolve(picture);
  const oldName = basename(picture);
  return text.replace(refPattern(oldName), (ref) =>
    target(ref, fromFile, docsDir) === want ? ref.slice(0, -oldName.length) + basename(newPicture) : ref,
  );
}
