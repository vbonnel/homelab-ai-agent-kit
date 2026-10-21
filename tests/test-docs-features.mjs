#!/usr/bin/env node
// Tests for the docs features (diagrams drawn at build time, diagram zoom, version pill) and
// `kit docs upgrade`.
// Run with: node --test tests/test-docs-features.mjs
// Temp folders and throwaway git repos only: no network, no npm install, no browser. pele is
// replaced by a fake draw function, npm by a stand-in command that only records its calls.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitView, zoomAt, zoomLimits } from '../templates/docs/src/scripts/zoom-math.mjs';
import { docsVersion } from '../templates/docs/src/version.mjs';
import { drawCode, drawDiagrams, diagramError, isDiagram, linesBefore } from '../templates/docs/src/diagrams/draw.mjs';
import {
  MARKER, KIT_COMPONENTS, KIT_DIAGRAMS, addComponents, upgradeDocs, useKitDiagrams, usesKitDiagrams,
} from '../lib/docs-upgrade.mjs';

const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(KIT_DIR, 'templates/docs');
const KIT_FILES = [...Object.values(KIT_COMPONENTS).flatMap((c) => c.files), ...KIT_DIAGRAMS.files];
const KINDS = ['service', 'ui', 'data', 'queue', 'external', 'person', 'new', 'risk'];
const near = (a, b) => Math.abs(a - b) < 1e-6;

// astro.config.mjs as `kit docs init` wrote it before the docs features
const OLD_CONFIG = `// Docs website for this project (Starlight). Created by the homelab agent kit.
// Pages live in src/content/docs/. Rebuilt automatically after each merge.
// Diagrams: write \`\`\`mermaid code blocks in the pages; they follow the light/dark theme.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
  telemetry: false,
  integrations: [
    mermaid({ theme: 'default', autoTheme: true, enableLog: false }), // must come before starlight
    starlight({
      title: '__PROJECT_TITLE__',
      sidebar: [
        { label: 'Context', link: '/' },
        { label: 'Getting started', link: '/getting-started/' },
        { label: 'Tech stack & how it works', link: '/how-it-works/' },
        { label: 'Operations & maintenance', link: '/operations/' },
        { label: 'Changelog', link: '/changelog/' },
      ],
    }),
  ],
});
`;

// astro.config.mjs as `kit docs init` wrote it with the zoom and version pill (diagrams still
// drawn by astro-mermaid in the browser)
const PREVIOUS_CONFIG = `// Docs website for this project (Starlight). Created by the homelab agent kit.
// Pages live in src/content/docs/. Rebuilt automatically after each merge.
// Diagrams: write \`\`\`mermaid code blocks in the pages; they follow the light/dark theme.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
  telemetry: false,
  integrations: [
    mermaid({ theme: 'default', autoTheme: true, enableLog: false }), // must come before starlight
    starlight({
      title: '__PROJECT_TITLE__',
      // Kit docs features (kit docs upgrade): the docs version next to the title, and an
      // "Enlarge" button on each diagram (zoom and move it full screen)
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
      },
      sidebar: [
        { label: 'Context', link: '/' },
        { label: 'Getting started', link: '/getting-started/' },
        { label: 'Tech stack & how it works', link: '/how-it-works/' },
        { label: 'Operations & maintenance', link: '/operations/' },
        { label: 'Changelog', link: '/changelog/' },
      ],
    }),
  ],
});
`;
const TEMPLATE_CONFIG = readFileSync(join(TEMPLATE, 'astro.config.mjs'), 'utf8');

const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-docs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
};
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', env: gitEnv, stdio: ['ignore', 'pipe', 'pipe'] }).trim();

// A docs folder like one made by an older kit: old config, pages, no kit files
function oldDocs(dir) {
  mkdirSync(join(dir, 'src/content/docs'), { recursive: true });
  writeFileSync(join(dir, 'package.json'), '{ "name": "docs" }\n');
  writeFileSync(join(dir, 'astro.config.mjs'), OLD_CONFIG.replace('__PROJECT_TITLE__', 'My project'));
  writeFileSync(join(dir, 'src/content/docs/index.md'), '---\ntitle: Context\n---\n\n```mermaid\nflowchart LR\n  A --> B\n```\n');
  writeFileSync(join(dir, 'src/content/docs/changelog.md'), '---\ntitle: Changelog\n---\n\n- first\n');
}
const pages = (dir) => ['index.md', 'changelog.md'].map((p) => readFileSync(join(dir, 'src/content/docs', p), 'utf8'));

// --- Zoom sums --------------------------------------------------------------------------
test('fit: the whole diagram inside the viewer, padding kept, centred, as big as possible', () => {
  const stage = { w: 1200, h: 800 };
  for (const content of [{ w: 3000, h: 600 }, { w: 400, h: 2400 }, { w: 300, h: 200 }]) {
    const v = fitView(content, stage, 24);
    assert.ok(v.x >= 24 - 1e-6 && v.y >= 24 - 1e-6, 'padding kept');
    assert.ok(v.x + content.w * v.scale <= stage.w - 24 + 1e-6 && v.y + content.h * v.scale <= stage.h - 24 + 1e-6, 'inside');
    assert.ok(near(v.x + (content.w * v.scale) / 2, 600) && near(v.y + (content.h * v.scale) / 2, 400), 'centred');
    assert.ok(near(v.x, 24) || near(v.y, 24), 'as big as it can be');
  }
  const empty = fitView({ w: 0, h: 0 }, stage);
  assert.ok(Number.isFinite(empty.scale) && empty.scale > 0, 'a diagram not drawn yet gives a usable view');
});

test('zoom: the spot under the pointer stays, in then out gives the start back, limits hold', () => {
  const start = fitView({ w: 3000, h: 600 }, { w: 1200, h: 800 }, 24);
  const limits = zoomLimits(start);
  assert.ok(limits.min < start.scale && start.scale < limits.max);
  assert.ok(limits.max >= 4, 'zooms to at least 4 times the diagram size');
  const point = { x: 900, y: 300 };
  const spot = (v) => ({ x: (point.x - v.x) / v.scale, y: (point.y - v.y) / v.scale });
  const zoomed = zoomAt(start, 3, point, limits);
  assert.ok(near(zoomed.scale, start.scale * 3));
  assert.ok(near(spot(zoomed).x, spot(start).x) && near(spot(zoomed).y, spot(start).y));
  const back = zoomAt(zoomed, 1 / 3, point, limits);
  assert.ok(near(back.scale, start.scale) && near(back.x, start.x) && near(back.y, start.y));
  assert.ok(near(zoomAt(start, 1000, point, limits).scale, limits.max));
  assert.ok(near(zoomAt(start, 0.001, point, limits).scale, limits.min));
});

// --- Version pill -----------------------------------------------------------------------
test('version: the merge save id and its date; empty values without history', (t) => {
  const T = tempDir(t);
  const save = (date, file, msg) => {
    writeFileSync(join(T, file), msg);
    git(T, 'add', file);
    execFileSync('git', ['-C', T, 'commit', '-qm', msg], { env: { ...gitEnv, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
  };
  git(T, 'init', '-q', '-b', 'main');
  save('2026-10-12T10:00:00+02:00', 'a.md', 'first');
  git(T, 'checkout', '-qb', 'feature/x');
  save('2026-10-13T09:00:00+02:00', 'b.md', 'build: x');
  git(T, 'checkout', '-q', 'main');
  execFileSync('git', ['-C', T, 'merge', '-q', '--no-ff', '-m', 'Feature: x', 'feature/x'],
    { env: { ...gitEnv, GIT_AUTHOR_DATE: '2026-10-17T22:05:00+02:00', GIT_COMMITTER_DATE: '2026-10-17T22:05:00+02:00' } });
  const v = docsVersion(T);
  assert.equal(v.id, git(T, 'rev-parse', '--short', 'HEAD'));
  assert.match(v.id, /^[0-9a-f]{7,}$/);
  assert.match(v.saved, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  assert.deepEqual(docsVersion(T), v, 'the same save gives the same version');
  assert.deepEqual(docsVersion(join(T, 'missing')), { id: '', saved: '' });
});

// --- Template -----------------------------------------------------------------------------
test('template: config sets both components, every kit file has the marker', () => {
  const config = readFileSync(join(TEMPLATE, 'astro.config.mjs'), 'utf8');
  for (const [name, c] of Object.entries(KIT_COMPONENTS)) assert.ok(config.includes(`${name}: '${c.path}'`), name);
  for (const rel of KIT_FILES) assert.ok(readFileSync(join(TEMPLATE, rel), 'utf8').includes(MARKER), rel);
  const title = readFileSync(join(TEMPLATE, 'src/components/SiteTitle.astro'), 'utf8');
  assert.ok(title.includes('docsVersion(') && title.includes('href="/changelog/"'), 'pill linked to the changelog');
  const content = readFileSync(join(TEMPLATE, 'src/components/MarkdownContent.astro'), 'utf8');
  assert.ok(content.includes("import '../scripts/diagram-zoom.mjs'") && content.includes('<slot />'), 'page + viewer');
  const viewer = readFileSync(join(TEMPLATE, 'src/scripts/diagram-zoom.mjs'), 'utf8');
  for (const needed of ["'div.kit-diagram, pre.mermaid'", 'querySelectorAll(DIAGRAMS)', 'showModal()', "from './zoom-math.mjs'"]) {
    assert.ok(viewer.includes(needed), needed);
  }
});

test('template: diagrams drawn by the kit integration (pele), no astro-mermaid left', () => {
  const config = readFileSync(join(TEMPLATE, 'astro.config.mjs'), 'utf8');
  assert.ok(usesKitDiagrams(config));
  assert.match(config, /^import diagrams from '\.\/src\/diagrams\/diagrams\.mjs';$/m);
  assert.match(config, /^ {4}diagrams\(\),/m);
  assert.ok(config.indexOf('diagrams(),') < config.indexOf('starlight({'), 'before starlight');
  assert.doesNotMatch(config, /astro-mermaid|mermaid\(/);
  const integration = readFileSync(join(TEMPLATE, 'src/diagrams/diagrams.mjs'), 'utf8');
  for (const needed of ["from 'pele'", "from './draw.mjs'", "'satteri'", 'mdastPlugins', 'remarkPlugins', "new URL('./theme.css'"]) {
    assert.ok(integration.includes(needed), needed);
  }
});

test('template: the theme colours every kind of box, in light and dark', () => {
  const css = readFileSync(join(TEMPLATE, 'src/diagrams/theme.css'), 'utf8');
  const block = (re) => css.match(re)[1];
  const dark = block(/^:root \{([\s\S]*?)^\}/m);
  const light = block(/^:root\[data-theme='light'\] \{([\s\S]*?)^\}/m);
  const colours = (text) => Object.fromEntries([...text.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6});/g)].map((m) => [m[1], m[2]]));
  const d = colours(dark), l = colours(light);
  assert.deepEqual(Object.keys(d).sort(), Object.keys(l).sort(), 'the same colours in both themes');
  for (const name of ['--pele-bg', '--pele-fg', '--pele-line', '--pele-surface', '--pele-border', '--pele-accent']) {
    assert.ok(d[name] && l[name] && d[name] !== l[name], name);
  }
  for (const kind of KINDS) {
    assert.ok(d[`--diagram-${kind}-fill`] && l[`--diagram-${kind}-fill`], `${kind} fill`);
    assert.match(css, new RegExp(`\\.pele-node\\.${kind}[,\\s]`), `${kind} rule`);
    assert.ok(css.includes(`  ${kind} `), `${kind} explained in the comment`);
  }
  assert.ok(css.includes('--pele-font:') && css.includes('Helvetica, Arial'), 'the fonts the sizes were measured with');
  const integration = readFileSync(join(TEMPLATE, 'src/diagrams/diagrams.mjs'), 'utf8');
  assert.ok(integration.includes("fontFamily: 'Helvetica, Arial, \"Liberation Sans\", Arimo, sans-serif'"), 'same fonts when drawing');
});

test('template: no addresses or host names in the kit files', () => {
  for (const rel of [...KIT_FILES, 'astro.config.mjs']) {
    const text = readFileSync(join(TEMPLATE, rel), 'utf8');
    assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, `${rel} has an IP address`);
  }
});

// --- Diagrams drawn when the website is built (draw.mjs, pele replaced by a fake) ----------
// The fake answers like pele: { svg, type }, or an error with the line inside the diagram
const fakeDraw = (calls = []) => (source, options) => {
  calls.push({ source, options });
  if (source.includes('-->> ')) throw Object.assign(new Error("Parse error on line 3:\n  B -->> \n-------^"), { line: 3, column: 8 });
  if (source.startsWith('zenuml')) throw Object.assign(new Error('No diagram type detected for the given text.'), { line: 0 });
  return { svg: `<svg class="pele"><text>${source.split('\n')[0]}</text></svg>`, type: source.startsWith('sequenceDiagram') ? 'sequence' : 'flowchart' };
};
// A ```mermaid block as Markdown gives it (an mdast `code` node); `line` = its ``` line
const block = (value, line, lang = 'mermaid') => ({ type: 'code', lang, value, position: { start: { line, column: 1 }, end: { line: line + 2, column: 4 } } });

test('drawCode: the picture in a kit-diagram box, ids numbered on the page', () => {
  const calls = [];
  const html = drawCode(block('flowchart LR\n  A --> B', 5), 2, 'src/content/docs/x.md', fakeDraw(calls));
  assert.equal(html, '<div class="kit-diagram" data-diagram="flowchart"><svg class="pele"><text>flowchart LR</text></svg></div>');
  assert.equal(calls[0].source, 'flowchart LR\n  A --> B');
  assert.deepEqual(calls[0].options, { idPrefix: 'kit-diagram-2-' });
  const odd = drawCode(block('x', 1), 1, 'p.md', () => ({ svg: '<svg/>', type: 'a"><b>' }));
  assert.equal(odd, '<div class="kit-diagram" data-diagram="ab"><svg/></div>', 'only a plain word in the attribute');
});

test('drawCode: a diagram error names the page and the line in the file', () => {
  const broken = block('flowchart LR\n  A --> B\n  B -->> ', 4);
  // Astro 7 counts lines from after the frontmatter: here 6 lines of the file come before
  assert.throws(() => drawCode(broken, 1, 'src/content/docs/broken.md', fakeDraw(), () => 6), (e) => {
    assert.equal(e.name, 'DiagramError');
    assert.equal(e.message.split('\n')[0], 'Diagram error in src/content/docs/broken.md, line 13 (line 3 of the diagram): Parse error on line 3:');
    assert.match(e.message, /B -->> \n-------\^$/, "pele's own pointer kept");
    assert.equal(e.cause.line, 3);
    return true;
  });
  assert.throws(() => drawCode(block('zenuml\n  A.b()', 9), 1, 'p.md', fakeDraw()),
    { message: 'Diagram error in p.md, in the diagram that starts at line 10: No diagram type detected for the given text.' });
  assert.equal(diagramError(new Error('bad'), { type: 'code' }, 'p.md').message, 'Diagram error in p.md: bad', 'no position');
});

test('drawDiagrams: every ```mermaid block of a page (also in a list) becomes its picture', () => {
  const js = block('let a = 1;', 20, 'js');
  const tree = { type: 'root', children: [
    { type: 'paragraph', children: [{ type: 'text', value: 'Hi' }] },
    block('flowchart LR\n  A --> B', 3),
    { type: 'list', children: [{ type: 'listItem', children: [block('sequenceDiagram\n  A->>B: hi', 8)] }] },
    js,
  ] };
  const before = structuredClone(js);
  const calls = [];
  assert.equal(drawDiagrams(tree, 'p.md', fakeDraw(calls)), 2);
  assert.deepEqual(calls.map((c) => c.options.idPrefix), ['kit-diagram-1-', 'kit-diagram-2-']);
  const [, first, list, last] = tree.children;
  assert.equal(first.type, 'html');
  assert.match(first.value, /^<div class="kit-diagram" data-diagram="flowchart"><svg/);
  assert.equal(first.lang, undefined);
  assert.equal(first.position.start.line, 3, 'position kept');
  assert.match(list.children[0].children[0].value, /data-diagram="sequence"/);
  assert.deepEqual(last, before, 'other code blocks untouched');
  assert.ok(isDiagram(block('x', 1)) && !isDiagram(js) && !isDiagram(undefined));
  assert.throws(() => drawDiagrams({ type: 'root', children: [block('a -->> ', 2)] }, 'p.md', fakeDraw(), () => 3),
    /^DiagramError: Diagram error in p\.md, line 8 /, 'the lines skipped count here too');
});

test('linesBefore: the lines of the file before the text Markdown got', () => {
  const file = '---\ntitle: Broken\n---\n\nSome text.\n\n```mermaid\nflowchart LR\n```\n';
  assert.equal(linesBefore(file, 'Some text.\n\n```mermaid\nflowchart LR\n```'), 4, 'frontmatter and a blank line; text trimmed');
  assert.equal(linesBefore(file, file), 0);
  assert.equal(linesBefore(file, 'not in the file'), 0);
  assert.equal(linesBefore(file, ''), 0);
  assert.equal(linesBefore(undefined, 'x'), 0);
});

// --- addComponents ---------------------------------------------------------------------
test('addComponents: the old template config gets both components, once', () => {
  const r = addComponents(OLD_CONFIG);
  assert.equal(r.problem, '');
  assert.deepEqual(r.added, ['SiteTitle', 'MarkdownContent']);
  assert.equal(r.text, PREVIOUS_CONFIG);
  const again = addComponents(r.text);
  assert.equal(again.text, r.text, 'a second run changes nothing');
  assert.deepEqual(again.added, []);
});

test('addComponents: an existing components block gets the missing entries, its own kept', () => {
  const own = OLD_CONFIG.replace("      title: '__PROJECT_TITLE__',\n",
    "      title: 'X',\n      components: {\n        Footer: './src/components/Footer.astro',\n      },\n");
  const r = addComponents(own);
  assert.equal(r.problem, '');
  assert.ok(r.text.includes("      components: {\n        SiteTitle: './src/components/SiteTitle.astro',\n        MarkdownContent: './src/components/MarkdownContent.astro',\n        Footer: './src/components/Footer.astro',\n      },"));
  assert.equal(r.text.match(/components\s*:/g).length, 1, 'still one components block');

  const otherTitle = own.replace("Footer: './src/components/Footer.astro'", "SiteTitle: './src/components/MyTitle.astro'");
  const k = addComponents(otherTitle);
  assert.deepEqual(k.kept, ['SiteTitle']);
  assert.deepEqual(k.added, ['MarkdownContent']);
  assert.ok(k.text.includes("SiteTitle: './src/components/MyTitle.astro'") && !k.text.includes('SiteTitle.astro'));
});

test('addComponents: a config it cannot read is left unchanged, with a problem', () => {
  for (const text of ["export default { title: 'x' };\n", OLD_CONFIG.replace("title: '__PROJECT_TITLE__',", "title: '__PROJECT_TITLE__'")]) {
    const r = addComponents(text);
    assert.notEqual(r.problem, '');
    assert.equal(r.text, text);
  }
});

// --- useKitDiagrams --------------------------------------------------------------------
test('useKitDiagrams: the kit\'s astro-mermaid lines become exactly the new template', () => {
  const r = useKitDiagrams(PREVIOUS_CONFIG);
  assert.deepEqual({ switched: r.switched, from: r.from, kept: r.kept }, { switched: true, from: 'astro-mermaid', kept: '' });
  assert.equal(r.text, TEMPLATE_CONFIG);
  assert.equal(useKitDiagrams(addComponents(OLD_CONFIG).text).text, TEMPLATE_CONFIG, 'the oldest config too');
  const again = useKitDiagrams(r.text);
  assert.deepEqual(again, { text: r.text, switched: false, from: '', kept: '' }, 'a second run changes nothing');
});

test('useKitDiagrams: own astro-mermaid settings kept; no diagrams yet: added before starlight', () => {
  const own = PREVIOUS_CONFIG.replace("theme: 'default'", "theme: 'forest'");
  const k = useKitDiagrams(own);
  assert.equal(k.text, own);
  assert.equal(k.switched, false);
  assert.match(k.kept, /astro-mermaid its own way/);

  const none = PREVIOUS_CONFIG.replace("import mermaid from 'astro-mermaid';\n", '').replace(/^ {4}mermaid\(.*\n/m, '');
  const n = useKitDiagrams(none);
  assert.deepEqual({ switched: n.switched, from: n.from }, { switched: true, from: '' });
  assert.ok(n.text.includes("import starlight from '@astrojs/starlight';\nimport diagrams from './src/diagrams/diagrams.mjs';\n"));
  assert.match(n.text, /\n {4}diagrams\(\), [^\n]*\n {4}starlight\(\{\n/);
  assert.equal(n.text.split('\n').length, none.split('\n').length + 2, 'two lines added, nothing else');

  const odd = 'export default { integrations: [] };\n';
  assert.deepEqual(useKitDiagrams(odd),
    { text: odd, switched: false, from: '', kept: 'astro.config.mjs: no `import starlight` line or no `starlight({` line found' });
});

// --- upgradeDocs ---------------------------------------------------------------------
test('upgradeDocs: adds, updates marked files, keeps the project\'s own, never touches pages', (t) => {
  const D = tempDir(t);
  oldDocs(D);
  const before = pages(D);
  mkdirSync(join(D, 'src/components'), { recursive: true });
  mkdirSync(join(D, 'src/scripts'), { recursive: true });
  writeFileSync(join(D, 'src/components/SiteTitle.astro'), '---\n// my own title\n---\n<h1>Mine</h1>\n');
  writeFileSync(join(D, 'src/scripts/zoom-math.mjs'), `// ${MARKER}. old version\nexport const old = 1;\n`);

  const r = upgradeDocs(D, TEMPLATE);
  assert.equal(r.problem, '');
  assert.deepEqual(pages(D), before, 'pages unchanged byte for byte');
  assert.equal(readFileSync(join(D, 'src/components/SiteTitle.astro'), 'utf8'), '---\n// my own title\n---\n<h1>Mine</h1>\n');
  assert.ok(r.kept.some((l) => l.includes('src/components/SiteTitle.astro')));
  for (const rel of KIT_FILES.filter((f) => f !== 'src/components/SiteTitle.astro')) {
    assert.equal(readFileSync(join(D, rel), 'utf8'), readFileSync(join(TEMPLATE, rel), 'utf8'), rel);
  }
  assert.ok(r.changed.includes("updated src/scripts/zoom-math.mjs to the kit's version"));
  assert.ok(r.changed.includes('astro.config.mjs: diagrams drawn by pele when the website is built, instead of astro-mermaid'));
  const config = readFileSync(join(D, 'astro.config.mjs'), 'utf8');
  assert.ok(config.includes("SiteTitle: './src/components/SiteTitle.astro'") && config.includes("title: 'My project',"));
  assert.equal(config, TEMPLATE_CONFIG.replace('__PROJECT_TITLE__', 'My project'));

  const again = upgradeDocs(D, TEMPLATE);
  assert.deepEqual(again.changed, [], 'a second run has nothing to do');
});

test('upgradeDocs: a site with its own astro-mermaid settings keeps them, and gets the rest', (t) => {
  const D = tempDir(t);
  oldDocs(D);
  const own = OLD_CONFIG.replace("theme: 'default'", "theme: 'forest'").replace('__PROJECT_TITLE__', 'Mine');
  writeFileSync(join(D, 'astro.config.mjs'), own);
  const r = upgradeDocs(D, TEMPLATE);
  assert.equal(r.problem, '');
  assert.ok(r.kept.some((l) => l.includes('astro-mermaid its own way') && l.includes('kit docs upgrade again')), 'says what to change');
  for (const rel of KIT_DIAGRAMS.files) assert.equal(existsSync(join(D, rel)), false, rel);
  assert.ok(existsSync(join(D, 'src/scripts/diagram-zoom.mjs')), 'the viewer is still added');
  const config = readFileSync(join(D, 'astro.config.mjs'), 'utf8');
  assert.ok(config.includes("theme: 'forest'") && !usesKitDiagrams(config));
  assert.ok(!r.changed.some((l) => l.includes('pele')));
});

test('upgradeDocs: a broken config means nothing is written at all', (t) => {
  const D = tempDir(t);
  oldDocs(D);
  writeFileSync(join(D, 'astro.config.mjs'), "export default { title: 'x' };\n");
  const r = upgradeDocs(D, TEMPLATE);
  assert.match(r.problem, /starlight/);
  assert.deepEqual(r.changed, []);
  for (const rel of KIT_FILES) assert.equal(existsSync(join(D, rel)), false, rel);
});

// --- kit docs upgrade (the real command) ---------------------------------------------
// A stand-in for npm, first on PATH: it only writes "<folder>|<arguments>" to a log
function fakeNpm(dir) {
  const bin = join(dir, 'bin');
  const log = join(dir, 'npm.log');
  mkdirSync(bin);
  writeFileSync(join(bin, 'npm'), '#!/bin/sh\nprintf "%s|%s\\n" "$PWD" "$*" >> "$NPM_LOG"\n');
  chmodSync(join(bin, 'npm'), 0o755);
  return {
    env: { PATH: `${bin}:${process.env.PATH}`, NPM_LOG: log },
    calls: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n') : []),
  };
}

test('kit docs upgrade: in the real project and in a work copy (only the work copy changes)', (t) => {
  const P = tempDir(t);
  git(P, 'init', '-q', '-b', 'main');
  oldDocs(join(P, 'docs'));
  git(P, 'add', '-A');
  git(P, 'commit', '-qm', 'start');
  const npm = fakeNpm(tempDir(t));
  const kit = (cwd) => execFileSync('bash', [join(KIT_DIR, 'bin/kit'), 'docs', 'upgrade'], {
    cwd, encoding: 'utf8', env: { ...gitEnv, ...npm.env, KIT_CONF: join(P, 'no-config') }, stdio: ['ignore', 'pipe', 'pipe'],
  });

  // The real project's packages, linked into the work copy like `kit start` does
  mkdirSync(join(P, 'docs/node_modules/astro-mermaid'), { recursive: true });
  const W = join(P, '.claude/worktrees/x');
  git(P, 'worktree', 'add', '-q', '-b', 'feature/x', W);
  symlinkSync(join(P, 'docs/node_modules'), join(W, 'docs/node_modules'));
  const out = kit(W);
  assert.match(out, /\[ok\] added src\/components\/SiteTitle\.astro/);
  assert.match(out, /\[ok\] astro\.config\.mjs: diagrams drawn by pele when the website is built, instead of astro-mermaid/);
  assert.ok(existsSync(join(W, 'docs/src/scripts/diagram-zoom.mjs')), 'work copy changed');
  assert.ok(existsSync(join(W, 'docs/src/diagrams/theme.css')));
  assert.equal(existsSync(join(P, 'docs/src/scripts/diagram-zoom.mjs')), false, 'real project untouched');
  // npm ran in the work copy, once its link to the real project's packages was gone
  const W_DOCS = join(W, 'docs');
  assert.deepEqual(npm.calls(), [
    `${W_DOCS}|install --no-audit --no-fund --loglevel=error pele@^1.8.0`,
    `${W_DOCS}|uninstall --no-audit --no-fund --loglevel=error astro-mermaid mermaid`,
  ]);
  assert.throws(() => lstatSync(join(W_DOCS, 'node_modules')), { code: 'ENOENT' }, 'link removed');
  assert.ok(existsSync(join(P, 'docs/node_modules/astro-mermaid')), "the real project's packages untouched");

  kit(P);
  assert.ok(existsSync(join(P, 'docs/src/version.mjs')));
  assert.equal(npm.calls().length, 4, 'the real project gets pele too');
  assert.match(npm.calls()[2], /^.*\/docs\|install .*pele@\^1\.8\.0$/);
  writeFileSync(join(P, 'docs/package.json'), '{ "name": "docs", "dependencies": { "pele": "^1.8.0" } }\n');
  assert.match(kit(P), /Nothing to add/);
  assert.equal(npm.calls().length, 4, 'pele already there: npm is not run again');
});
