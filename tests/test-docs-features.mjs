#!/usr/bin/env node
// Tests for the docs features (diagram zoom, version pill) and `kit docs upgrade`.
// Run with: node --test tests/test-docs-features.mjs
// Temp folders and throwaway git repos only: no network, no npm install, no browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitView, zoomAt, zoomLimits } from '../templates/docs/src/scripts/zoom-math.mjs';
import { docsVersion } from '../templates/docs/src/version.mjs';
import { MARKER, KIT_COMPONENTS, addComponents, upgradeDocs } from '../lib/docs-upgrade.mjs';

const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(KIT_DIR, 'templates/docs');
const KIT_FILES = Object.values(KIT_COMPONENTS).flatMap((c) => c.files);
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
  for (const needed of ["querySelectorAll('pre.mermaid')", 'showModal()', "from './zoom-math.mjs'"]) assert.ok(viewer.includes(needed), needed);
});

test('template: no addresses or host names in the kit files', () => {
  for (const rel of [...KIT_FILES, 'astro.config.mjs']) {
    const text = readFileSync(join(TEMPLATE, rel), 'utf8');
    assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, `${rel} has an IP address`);
  }
});

// --- addComponents ---------------------------------------------------------------------
test('addComponents: the old template config becomes exactly the new template config', () => {
  const r = addComponents(OLD_CONFIG);
  assert.equal(r.problem, '');
  assert.deepEqual(r.added, ['SiteTitle', 'MarkdownContent']);
  assert.equal(r.text, readFileSync(join(TEMPLATE, 'astro.config.mjs'), 'utf8'));
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
  const config = readFileSync(join(D, 'astro.config.mjs'), 'utf8');
  assert.ok(config.includes("SiteTitle: './src/components/SiteTitle.astro'") && config.includes("title: 'My project',"));

  const again = upgradeDocs(D, TEMPLATE);
  assert.deepEqual(again.changed, [], 'a second run has nothing to do');
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
test('kit docs upgrade: in the real project and in a work copy (only the work copy changes)', (t) => {
  const P = tempDir(t);
  git(P, 'init', '-q', '-b', 'main');
  oldDocs(join(P, 'docs'));
  git(P, 'add', '-A');
  git(P, 'commit', '-qm', 'start');
  const kit = (cwd) => execFileSync('bash', [join(KIT_DIR, 'bin/kit'), 'docs', 'upgrade'], {
    cwd, encoding: 'utf8', env: { ...gitEnv, KIT_CONF: join(P, 'no-config') }, stdio: ['ignore', 'pipe', 'pipe'],
  });

  const W = join(P, '.claude/worktrees/x');
  git(P, 'worktree', 'add', '-q', '-b', 'feature/x', W);
  const out = kit(W);
  assert.match(out, /\[ok\] added src\/components\/SiteTitle\.astro/);
  assert.ok(existsSync(join(W, 'docs/src/scripts/diagram-zoom.mjs')), 'work copy changed');
  assert.equal(existsSync(join(P, 'docs/src/scripts/diagram-zoom.mjs')), false, 'real project untouched');

  kit(P);
  assert.ok(existsSync(join(P, 'docs/src/version.mjs')));
  assert.match(kit(P), /Nothing to add/);
});
