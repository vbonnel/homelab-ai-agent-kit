#!/usr/bin/env node
// Add the kit's docs features to a docs website, or bring their files up to date:
//   node docs-upgrade.mjs <docs folder>        (used by `kit docs init` and `kit docs upgrade`)
// - The diagram viewer ("Enlarge" button, zoom and move full screen) and the version pill next
//   to the site title: Starlight components set in astro.config.mjs, files in src/.
// - A missing file is added; a file with the "agent-kit: managed file" line is replaced by the
//   kit's version; a file without that line is the project's own and is kept.
// - Pages and every other file are never touched. Nothing is written when astro.config.mjs
//   can't be read safely: the message says what to add by hand.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const MARKER = 'agent-kit: managed file';

// Each component and the files it needs (paths inside the docs folder)
export const KIT_COMPONENTS = {
  SiteTitle: {
    path: './src/components/SiteTitle.astro',
    files: ['src/components/SiteTitle.astro', 'src/version.mjs'],
  },
  MarkdownContent: {
    path: './src/components/MarkdownContent.astro',
    files: ['src/components/MarkdownContent.astro', 'src/scripts/diagram-zoom.mjs', 'src/scripts/zoom-math.mjs'],
  },
};

const COMMENT = [
  '// Kit docs features (kit docs upgrade): the docs version next to the title, and an',
  '// "Enlarge" button on each diagram (zoom and move it full screen)',
];
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
  if (!missing.length) return { text, added, kept, problem: '' };
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
    return { text: head + body.slice(0, lineEnd) + lines + body.slice(lineEnd), added: missing, kept, problem: '' };
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

// Add or update the kit's docs features in docsDir. Returns { changed, kept, problem }
// (lists of short sentences); with a problem nothing was written.
export function upgradeDocs(docsDir, templateDir = resolve(dirname(fileURLToPath(import.meta.url)), '../templates/docs')) {
  const changed = [], kept = [];
  const configPath = join(docsDir, 'astro.config.mjs');
  if (!existsSync(configPath)) return { changed, kept, problem: `no astro.config.mjs in ${docsDir}` };
  const before = readFileSync(configPath, 'utf8');
  const config = addComponents(before);
  if (config.problem) return { changed, kept, problem: `astro.config.mjs: ${config.problem}. ${BY_HAND}` };

  for (const [name, c] of Object.entries(KIT_COMPONENTS)) {
    if (config.kept.includes(name)) {
      kept.push(`astro.config.mjs sets its own ${name} component: its kit files are not added`);
      continue;
    }
    for (const rel of c.files) {
      const kit = readFileSync(join(templateDir, rel), 'utf8');
      const dest = join(docsDir, rel);
      if (!existsSync(dest)) {
        mkdirSync(dirname(dest), { recursive: true });
        writeFileSync(dest, kit);
        changed.push(`added ${rel}`);
      } else {
        const mine = readFileSync(dest, 'utf8');
        if (mine === kit) continue;
        if (mine.includes(MARKER)) { writeFileSync(dest, kit); changed.push(`updated ${rel} to the kit's version`); }
        else kept.push(`kept your own ${rel} (it has no "${MARKER}" line)`);
      }
    }
  }
  if (config.text !== before) {
    writeFileSync(configPath, config.text);
    changed.push(`astro.config.mjs: added the ${config.added.join(' and ')} component${config.added.length > 1 ? 's' : ''}`);
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
