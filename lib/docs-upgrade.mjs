#!/usr/bin/env node
// Add the kit's docs features to a docs website, or bring their files up to date:
//   node docs-upgrade.mjs <docs folder>        (used by `kit docs init` and `kit docs upgrade`)
// - The diagram and picture viewer (click one: zoom and move full screen) and the version pill next
//   to the site title: Starlight components set in astro.config.mjs, files in src/.
// - Page actions next to each page title (copy the page as Markdown, print it, open it in
//   Claude / ChatGPT when the site has a public address), the "On this page" list style and a
//   light / dark icon button: Starlight components too, files in src/.
// - Pictures (src/image-tools/): several widths per picture, too-big originals stop the build,
//   `npm run images` fixes them: an integration in astro.config.mjs and a package.json script.
// - Diagrams drawn by pele when the website is built (src/diagrams/), instead of astro-mermaid:
//   the kit's astro-mermaid lines in astro.config.mjs are swapped for the kit's integration.
//   The npm packages (pele in, astro-mermaid and mermaid out) are changed by `kit docs upgrade`.
// - A missing file is added; a file with the "agent-kit: managed file" line is replaced by the
//   kit's version; a file without that line is the project's own and is kept.
// - Pages and every other file are never touched. Nothing is written when astro.config.mjs
//   can't be read safely: the message says what to add by hand.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'agent-kit: managed file';

// Each component and the files it needs (paths inside the docs folder). The order is the one
// they get in a config (new entries go on top of an existing components block).
export const KIT_COMPONENTS = {
  PageTitle: {
    path: './src/components/PageTitle.astro',
    files: [
      'src/components/PageTitle.astro', 'src/components/PageActions.astro', 'src/pages/[...slug].md.ts',
      'src/scripts/page-markdown.mjs', 'src/scripts/print-pictures.mjs',
    ],
  },
  TableOfContents: {
    path: './src/components/TableOfContents.astro',
    files: ['src/components/TableOfContents.astro'],
  },
  ThemeSelect: {
    path: './src/components/ThemeSelect.astro',
    files: ['src/components/ThemeSelect.astro'],
  },
  SiteTitle: {
    path: './src/components/SiteTitle.astro',
    files: ['src/components/SiteTitle.astro', 'src/version.mjs'],
  },
  MarkdownContent: {
    path: './src/components/MarkdownContent.astro',
    files: ['src/components/MarkdownContent.astro', 'src/scripts/diagram-zoom.mjs', 'src/scripts/zoom-math.mjs'],
  },
};

// The pictures: an integration in astro.config.mjs, its files, and the `npm run images` script
export const KIT_IMAGES = {
  path: './src/image-tools/images.mjs',
  files: ['src/image-tools/images.mjs', 'src/image-tools/rules.mjs', 'src/image-tools/check.mjs', 'src/image-tools/optimize.mjs'],
  script: 'node src/image-tools/optimize.mjs',
};
const IMAGES_IMPORT = `import images from '${KIT_IMAGES.path}';`;
const IMAGES_CALL = 'images(), // pictures: a few widths each; a too-big original stops the build (npm run images fixes it)';

// The diagrams drawn when the website is built: an integration in astro.config.mjs, and its files
export const KIT_DIAGRAMS = {
  path: './src/diagrams/diagrams.mjs',
  files: ['src/diagrams/diagrams.mjs', 'src/diagrams/draw.mjs', 'src/diagrams/theme.css'],
};
const DIAGRAMS_IMPORT = `import diagrams from '${KIT_DIAGRAMS.path}';`;
const DIAGRAMS_CALL = 'diagrams(), // ```mermaid blocks drawn by pele (src/diagrams/); before starlight';
// What `kit docs init` wrote before: astro-mermaid, drawing in the browser
const MERMAID_IMPORT = /^import mermaid from (['"])astro-mermaid\1;?[ \t]*$/m;
const MERMAID_CALL = /^([ \t]*)mermaid\(\{\s*theme:\s*'default',\s*autoTheme:\s*true,\s*enableLog:\s*false\s*\}\),[^\n]*$/m;
const MERMAID_COMMENT = '// Diagrams: write ```mermaid code blocks in the pages; they follow the light/dark theme.';
const DIAGRAMS_COMMENT = '// Diagrams: write ```mermaid code blocks in the pages. They are drawn when the website is built,\n'
  + '// in colours that follow the light/dark theme; a diagram with an error stops the build.\n'
  + '// Kinds of boxes (:::data, :::external...): see src/diagrams/theme.css.';
const DIAGRAMS_BY_HAND = 'to draw them with pele, in astro.config.mjs replace the astro-mermaid import by\n'
  + `  ${DIAGRAMS_IMPORT}\n`
  + 'and the mermaid({ ... }) line in integrations by\n'
  + `  ${DIAGRAMS_CALL}\n`
  + 'then run kit docs upgrade again';

const COMMENT = [
  '// Kit docs features (kit docs upgrade): the docs version next to the title, a full-screen',
  '// viewer (click a diagram or a picture to zoom and move it), page actions next to the page',
  '// title (copy as Markdown, print), the "On this page" style and a light / dark button',
];
// The comments older kits wrote with the components: brought up to date by the next upgrade,
// with their indentation
const OLD_COMMENTS = [
  /^([ \t]*)\/\/ Kit docs features \(kit docs upgrade\): the docs version next to the title, and an\n[ \t]*\/\/ "Enlarge" button on each diagram \(zoom and move it full screen\)$/m,
  /^([ \t]*)\/\/ Kit docs features \(kit docs upgrade\): the docs version next to the title, and a\n[ \t]*\/\/ full-screen viewer: click a diagram or a picture to zoom and move it$/m,
];
const refreshComment = (text) => OLD_COMMENTS.reduce(
  (out, old) => out.replace(old, (m, ind) => COMMENT.map((l) => ind + l).join('\n')), text);
const BY_HAND = 'add this inside starlight({ ... }) in astro.config.mjs by hand, then run kit docs upgrade again:\n'
  + '  components: {\n'
  + Object.entries(KIT_COMPONENTS).map(([name, c]) => `    ${name}: '${c.path}',\n`).join('')
  + '  },';

// Add the kit's components to astro.config.mjs (as text, so comments and layout stay).
// Returns { text, added, kept, problem }: `kept` = components the project already sets to
// another file; with a problem, `text` is unchanged.
export function addComponents(text) {
  const added = [], kept = [];
  const start = text.indexOf('starlight({');
  if (start < 0) return { text, added, kept, problem: 'no `starlight({` found' };
  const head = text.slice(0, start), body = text.slice(start);

  const missing = [];
  for (const [name, c] of Object.entries(KIT_COMPONENTS)) {
    const set = new RegExp(`\\b${name}\\s*:\\s*(['"])([^'"]*)\\1`).exec(body);
    if (!set) missing.push(name);
    else if (set[2] !== c.path) kept.push(name);
  }
  if (!missing.length) return { text: refreshComment(text), added, kept, problem: '' };
  const entry = (name, indent) => `${indent}${name}: '${KIT_COMPONENTS[name].path}',\n`;

  // starlight({ ... components: { ...  -> add the missing entries at the top of that block
  const block = /\bcomponents\s*:\s*\{/.exec(body);
  if (block) {
    const at = block.index + block[0].length;
    const rest = body.slice(at);
    const next = /^[ \t]*\n([ \t]*)\S/.exec(rest);
    if (!next) return { text, added, kept, problem: 'the `components: {` block is on one line' };
    const lineEnd = at + rest.indexOf('\n') + 1;
    const lines = missing.map((name) => entry(name, next[1])).join('');
    return { text: refreshComment(head + body.slice(0, lineEnd) + lines + body.slice(lineEnd)), added: missing, kept, problem: '' };
  }

  // No components yet: a new block after the `title:` line, with the same indentation
  const title = /\n([ \t]*)title\s*:[^\n]*\n/.exec(body);
  if (!title) return { text, added, kept, problem: 'no `title:` line found after `starlight({`' };
  const titleLine = title[0].slice(1, -1);
  if (!/,\s*(\/\/.*)?$/.test(titleLine)) return { text, added, kept, problem: 'the `title:` line does not end with a comma' };
  const ind = title[1];
  const lines = COMMENT.map((l) => `${ind}${l}\n`).join('')
    + `${ind}components: {\n`
    + missing.map((name) => entry(name, `${ind}  `)).join('')
    + `${ind}},\n`;
  const at = title.index + title[0].length;
  return { text: head + body.slice(0, at) + lines + body.slice(at), added: missing, kept, problem: '' };
}

export const usesKitDiagrams = (text) => text.includes(`'${KIT_DIAGRAMS.path}'`);

// Draw the diagrams with the kit's integration (pele, at build time): it replaces the kit's
// astro-mermaid lines, or is added before starlight() when the config has no diagrams yet (as
// text, so comments and layout stay). Returns { text, switched, from, kept }: `from` is
// 'astro-mermaid' when it replaced it; `kept` says why the diagrams stay as they are.
export function useKitDiagrams(text) {
  const done = (out, from) => ({ text: out, switched: true, from, kept: '' });
  if (usesKitDiagrams(text)) return { text, switched: false, from: '', kept: '' };
  const imp = MERMAID_IMPORT.exec(text);
  const call = MERMAID_CALL.exec(text);
  if (imp && call) {
    return done(text
      .replace(MERMAID_IMPORT, () => DIAGRAMS_IMPORT)
      .replace(MERMAID_CALL, () => `${call[1]}${DIAGRAMS_CALL}`)
      .replace(MERMAID_COMMENT, () => DIAGRAMS_COMMENT), 'astro-mermaid');
  }
  if (imp || /\bmermaid\s*\(/.test(text)) {
    return { text, switched: false, from: '', kept: 'astro.config.mjs sets astro-mermaid its own way' };
  }
  const starlightImport = /^import starlight from (['"])@astrojs\/starlight\1;?[ \t]*\n/m.exec(text);
  const starlightCall = /^([ \t]*)starlight\(\{/m.exec(text);
  if (!starlightImport || !starlightCall) {
    return { text, switched: false, from: '', kept: 'astro.config.mjs: no `import starlight` line or no `starlight({` line found' };
  }
  const withImport = text.replace(starlightImport[0], (line) => `${line}${DIAGRAMS_IMPORT}\n`);
  return done(withImport.replace(starlightCall[0], (line) => `${starlightCall[1]}${DIAGRAMS_CALL}\n${line}`), '');
}

export const usesKitImages = (text) => text.includes(`'${KIT_IMAGES.path}'`);

// Add the kit's pictures integration (as text): its import after the diagrams' import (or after
// `import starlight`), its call just before `starlight({`. Returns { text, added, kept }: `kept`
// says why it could not be added.
export function useKitImages(text) {
  if (usesKitImages(text)) return { text, added: false, kept: '' };
  const after = new RegExp(`^${DIAGRAMS_IMPORT.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}[ \t]*\n`, 'm').exec(text)
    || /^import starlight from (['"])@astrojs\/starlight\1;?[ \t]*\n/m.exec(text);
  const call = /^([ \t]*)starlight\(\{/m.exec(text);
  if (!after || !call) {
    return { text, added: false, kept: 'astro.config.mjs: no `import starlight` line or no `starlight({` line found' };
  }
  const withImport = text.replace(after[0], (line) => `${line}${IMAGES_IMPORT}\n`);
  return { text: withImport.replace(call[0], (line) => `${call[1]}${IMAGES_CALL}\n${line}`), added: true, kept: '' };
}

// package.json with the `images` script (`npm run images`). Returns { text, added, kept }; a
// project's own `images` script is kept.
export function addImagesScript(text) {
  let pkg;
  try { pkg = JSON.parse(text); } catch { return { text, added: false, kept: 'package.json could not be read' }; }
  const scripts = pkg.scripts ?? {};
  if (scripts.images === KIT_IMAGES.script) return { text, added: false, kept: '' };
  if (scripts.images) return { text, added: false, kept: `package.json has its own "images" script (kept): the kit's is "${KIT_IMAGES.script}"` };
  pkg.scripts = { ...scripts, images: KIT_IMAGES.script };
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? '  ';
  return { text: JSON.stringify(pkg, null, indent) + '\n', added: true, kept: '' };
}

// Add or update the kit's docs features in docsDir. Returns { changed, kept, problem }
// (lists of short sentences); with a problem nothing was written.
export function upgradeDocs(docsDir, templateDir = resolve(dirname(fileURLToPath(import.meta.url)), '../templates/docs')) {
  const changed = [], kept = [];
  const configPath = join(docsDir, 'astro.config.mjs');
  if (!existsSync(configPath)) return { changed, kept, problem: `no astro.config.mjs in ${docsDir}` };
  const before = readFileSync(configPath, 'utf8');
  const config = addComponents(before);
  if (config.problem) return { changed, kept, problem: `astro.config.mjs: ${config.problem}. ${BY_HAND}` };
  const drawing = useKitDiagrams(config.text);
  const pictures = useKitImages(drawing.text);

  const copy = (rel) => {
    const kit = readFileSync(join(templateDir, rel), 'utf8');
    const dest = join(docsDir, rel);
    if (!existsSync(dest)) {
      mkdirSync(dirname(dest), { recursive: true });
      writeFileSync(dest, kit);
      changed.push(`added ${rel}`);
    } else {
      const mine = readFileSync(dest, 'utf8');
      if (mine === kit) return;
      if (mine.includes(MARKER)) { writeFileSync(dest, kit); changed.push(`updated ${rel} to the kit's version`); }
      else kept.push(`kept your own ${rel} (it has no "${MARKER}" line)`);
    }
  };
  for (const [name, c] of Object.entries(KIT_COMPONENTS)) {
    if (config.kept.includes(name)) {
      kept.push(`astro.config.mjs sets its own ${name} component: its kit files are not added`);
      continue;
    }
    c.files.forEach(copy);
  }
  if (usesKitDiagrams(drawing.text)) KIT_DIAGRAMS.files.forEach(copy);
  else kept.push(`${drawing.kept}: diagrams are drawn as before; ${DIAGRAMS_BY_HAND}`);

  if (usesKitImages(pictures.text)) {
    KIT_IMAGES.files.forEach(copy);
    const pkgPath = join(docsDir, 'package.json');
    if (existsSync(pkgPath)) {
      const script = addImagesScript(readFileSync(pkgPath, 'utf8'));
      if (script.added) { writeFileSync(pkgPath, script.text); changed.push('package.json: added the "images" script (npm run images)'); }
      if (script.kept) kept.push(script.kept);
    }
  } else {
    kept.push(`${pictures.kept}: no picture checks; add ${IMAGES_IMPORT} and ${IMAGES_CALL.split(',')[0]}, by hand`);
  }

  if (pictures.text !== before) {
    writeFileSync(configPath, pictures.text);
    if (config.added.length) {
      const names = config.added.length > 1 ? `${config.added.slice(0, -1).join(', ')} and ${config.added.at(-1)}` : config.added[0];
      changed.push(`astro.config.mjs: added the ${names} component${config.added.length > 1 ? 's' : ''}`);
    }
    if (drawing.switched) {
      changed.push(`astro.config.mjs: diagrams drawn by pele when the website is built${drawing.from ? `, instead of ${drawing.from}` : ''}`);
    }
    if (pictures.added) changed.push('astro.config.mjs: pictures in a few widths, checked on each build (images())');
  }
  return { changed, kept, problem: '' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dir = process.argv[2];
  if (!dir) { console.error('Usage: node docs-upgrade.mjs <docs folder>'); process.exit(2); }
  const r = upgradeDocs(resolve(dir));
  if (r.problem) { console.error(`NOT CHANGED: ${r.problem}`); process.exit(1); }
  for (const line of r.changed) console.log(`  [ok] ${line}`);
  for (const line of r.kept) console.log(`  [kept] ${line}`);
  if (!r.changed.length) console.log('  Nothing to add: the docs website already has the kit docs features.');
}
