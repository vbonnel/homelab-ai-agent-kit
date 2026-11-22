#!/usr/bin/env node
// Tests for changing a docs page's text in the browser (the Edit button): the shown text lined up
// with its Markdown, typed text written as text, the build plugin (a fake Sätteri context), the
// docs server's /_kit/edit (a local server on port 0, a fake build, throwaway git repos) and
// `kit docs edit`. Run with: node --test tests/test-page-edit.mjs. No network, npm or browser.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  alignText, applyEdits, atLineStart, blockStartAt, bodyOffset, codeRange, escapeTyped, titleRange, yamlScalar, yamlValue,
} from '../templates/docs/src/page-edit/markdown-text.mjs';
import { editableProps, pageEditPlugin } from '../templates/docs/src/page-edit/page-edit.mjs';
import { cleanPaste, collectEdits, errorMessage, labels, parseRange, savedMessage } from '../templates/docs/src/scripts/page-edit.mjs';
import { editSettings, hostAllowed, hostName, pageInfo, sameOrigin, toolEnv } from '../lib/docs-edit.mjs';
import { startDocsServer } from '../lib/docs-serve.mjs';
import {
  brokenLinks, contentLinks, headingIds, pageLinks, pageUrl, renamedSections, resolveLink, rewriteSectionLinks, siteLinks,
} from '../lib/docs-links.mjs';
import { KIT_COMPONENTS, KIT_PAGE_EDIT, MARKER, upgradeDocs, usesKitPageEdit } from '../lib/docs-upgrade.mjs';

const KIT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATE = join(KIT_DIR, 'templates/docs');

// The server saves with git from this process: a throwaway identity, no user config
Object.assign(process.env, {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
});
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const tempDir = (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'kit-edit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
};
const sha256 = (text) => createHash('sha256').update(text).digest('hex');

// --- Shown text lined up with the source -----------------------------------------------------
test('alignText: same text, smart punctuation, escapes, entities', () => {
  assert.deepEqual(alignText('plain', 'plain'), [0, 1, 2, 3, 4, 5]);
  const src = 'It\'s "ok" -- yes --- no ... end';
  const shown = 'It’s “ok” – yes — no … end';
  const map = alignText(src, shown);
  assert.ok(map);
  for (const word of ['ok', 'yes', 'no', 'end']) assert.equal(map[shown.indexOf(word)], src.indexOf(word), word);
  assert.equal(map[shown.length], src.length);
  assert.ok(alignText('a \\*b\\* \\\\ c', 'a *b* \\ c'), 'backslash escapes');
  assert.equal(alignText('a \\*b', 'a \\*b'), null, 'an escape shows only the character after it');
  assert.ok(alignText('C:\\Users', 'C:\\Users'), 'a backslash before a letter is itself');
  assert.ok(alignText('AT&amp;T &copy; &#169; &#x263A; &nbsp;x', 'AT&T © © ☺ \u00a0x'), 'entities');
  assert.ok(alignText('&bogus; &amp', '&bogus; &amp'), 'not entities: as written');
  assert.equal(alignText('it is', 'it was'), null);
  assert.equal(alignText('short', 'shorter'), null);
  assert.equal(alignText('longer', 'long'), null);
});

test('alignText: line breaks of quotes and lists, spaces around the text', () => {
  const quote = alignText('Quote one  \n> quote two', 'Quote one\nquote two');
  assert.ok(quote);
  assert.equal(quote['Quote one\n'.length], 'Quote one  \n> '.length, 'the next line starts after its >');
  assert.equal(quote[9], 9, 'the line ends before its spaces');
  assert.ok(alignText('one\r\n   two', 'one\ntwo'), 'Windows line ends, list indentation');
  assert.ok(alignText('> a\n> > b', '> a\nb'), 'nested quote markers');
  assert.equal(alignText('one two', 'one\ntwo'), null, 'no line break in the source');
  const lead = alignText('   text  ', 'text');
  assert.equal(lead[0], 3);
  assert.equal(lead[4], 7, 'the end is after the last character, not after the spaces');
});

test('codeRange and bodyOffset', () => {
  assert.deepEqual(codeRange('`x`', 'x'), [1, 2]);
  assert.deepEqual(codeRange('`` a`b ``', 'a`b'), [3, 6]);
  assert.deepEqual(codeRange('` x `', 'x'), [2, 3]);
  assert.deepEqual(codeRange('`  `', '  '), [1, 3], 'only spaces: kept');
  assert.equal(codeRange('`x`', 'y'), null);
  assert.equal(codeRange('x', 'x'), null);
  assert.equal(codeRange('```', '`'), null);
  const file = '---\ntitle: X\n---\n\nBody text.\n';
  assert.equal(bodyOffset(file, 'Body text.'), file.indexOf('Body'));
  const blanked = file.replace(/^---[\s\S]*?---/, (m) => m.replace(/[^\n]/g, ' '));
  assert.equal(bodyOffset(file, blanked), 0, 'frontmatter blanked (MDX): same length');
  assert.equal(bodyOffset(file, 'not there'), -1);
  assert.equal(bodyOffset(undefined, 'x'), -1);
});

// --- Typed text written as text -----------------------------------------------------------------
test('escapeTyped: Markdown characters stay text', () => {
  const cases = [
    ['plain words', 'plain words'], ['a*b', 'a\\*b'], ['snake_case', 'snake_case'], ['_x_', '\\_x\\_'],
    ['[l](u)', '\\[l\\](u)'], ['<b>', '\\<b>'], ['R&D', 'R&D'], ['&amp;', '\\&amp;'], ['~~x~~', '\\~\\~x\\~\\~'],
    ['a`b', 'a\\`b'], ['C:\\x', 'C:\\\\x'], ['a | b', 'a | b'], ['C# {x}', 'C# {x}'], ['a -> b', 'a -> b'],
    ['line\nnext\ttab\u00a0nbsp', 'line next tab nbsp'], ['bell\u0007', 'bell'],
  ];
  for (const [typed, written] of cases) assert.equal(escapeTyped(typed), written, typed);
  assert.equal(escapeTyped('a | b', { cell: true }), 'a \\| b');
  assert.equal(escapeTyped('C# 2', { heading: true }), 'C\\# 2');
  assert.equal(escapeTyped('{x} <y>', { mdx: true }), '\\{x\\} \\<y>');
  for (const [typed, written] of [['# a', '\\# a'], ['- a', '\\- a'], ['+ a', '\\+ a'], ['1. a', '1\\. a'], ['12) a', '12\\) a'],
    ['  > q', '\\> q'], ['::: note', '\\::: note'], ['===', '\\==='], ['hello', 'hello'], ['-x', '-x'], ['2024 was', '2024 was']]) {
    assert.equal(escapeTyped(typed, { lineStart: true }), written, `line start: ${typed}`);
  }
});

test('escapeTyped in code: no escapes, a backtick refused, | in table cells', () => {
  assert.equal(escapeTyped('a*b_c <d> {e}', { code: true, mdx: true }), 'a*b_c <d> {e}');
  assert.equal(escapeTyped('a|b', { code: true }), 'a|b');
  assert.equal(escapeTyped('a|b', { code: true, cell: true }), 'a\\|b');
  assert.equal(escapeTyped('a`b', { code: true }), null);
  assert.equal(escapeTyped('x\ny', { code: true }), 'x y');
});

test('atLineStart and blockStartAt', () => {
  const text = 'para\n> quote\n- item\n  1. sub\nmid text';
  assert.equal(atLineStart(text, 0), true);
  assert.equal(atLineStart(text, text.indexOf('quote')), true);
  assert.equal(atLineStart(text, text.indexOf('item')), true);
  assert.equal(atLineStart(text, text.indexOf('sub')), true);
  assert.equal(atLineStart(text, text.indexOf('text')), false);
  assert.equal(blockStartAt('# x'), 0);
  assert.equal(blockStartAt('  * x'), 2);
  assert.equal(blockStartAt('10. x'), 2);
  assert.equal(blockStartAt('---'), 0);
  assert.equal(blockStartAt('```js'), 0);
  for (const fine of ['#hashtag', 'x - y', '1.5 litres', 'text', '**bold**']) assert.equal(blockStartAt(fine), -1, fine);
});

// --- The page title -------------------------------------------------------------------------------
test('titleRange, yamlValue and yamlScalar', () => {
  const file = '---\ntitle: Getting started\ndescription: x\n---\nBody\n';
  const r = titleRange(file);
  assert.deepEqual(r, { s: file.indexOf('Getting'), e: file.indexOf('Getting') + 15, value: 'Getting started' });
  const quoted = '\ufeff---\r\ntitle: "A: b"\r\n---\r\n';
  const q = titleRange(quoted);
  assert.equal(quoted.slice(q.s, q.e), '"A: b"');
  assert.equal(q.value, 'A: b');
  assert.equal(titleRange("---\ntitle: 'It''s'\n---\n").value, "It's");
  for (const none of ['no frontmatter', '---\ndescription: x\n---\n', '---\ntitle: >-\n  folded\n---\n', '---\ntitle: a # note\n---\n']) {
    assert.equal(titleRange(none), null, none);
  }
  assert.equal(yamlValue('"bad'), null);
  assert.equal(yamlScalar('Plain title'), 'Plain title');
  assert.equal(yamlScalar('A: b'), '"A: b"');
  assert.equal(yamlScalar('yes'), '"yes"');
  assert.equal(yamlScalar('# not a comment'), '"# not a comment"');
  assert.equal(yamlScalar('Same "style"', '"x"'), '"Same \\"style\\""');
  assert.equal(yamlScalar("It's", "'x'"), "'It''s'");
  assert.equal(yamlScalar('  two\nlines '), 'two lines');
});

// --- applyEdits: the file changes only where the text changed ------------------------------------
const PAGE = `---
title: Sample page
---

It's a **bold** move, see \`port 80\` and [the docs](https://docs.example/).
Second line.

Version 1. Then more.

## Heading here

| Name | Value |
| ---- | ----- |
| port | \`4321\` |

> Quote one
> quote two
`;
// The editable range of `piece` (its first place after `after`) with its kind, as the build marks it
const at = (piece, after = '') => PAGE.indexOf(piece, after ? PAGE.indexOf(after) : 0);
const R = {
  first: { s: at("It's a "), e: at("It's a ") + 7, kind: '', outer: null },
  bold: { s: at('bold'), e: at('bold') + 4, kind: 'e', outer: { s: at('**bold**'), e: at('**bold**') + 8 } },
  move: { s: at(' move, see '), e: at(' move, see ') + 11, kind: '', outer: null },
  code: { s: at('port 80'), e: at('port 80') + 7, kind: 'c', outer: { s: at('`port 80`'), e: at('`port 80`') + 9 } },
  version: { s: at('Version 1.'), e: at('Version 1.') + 21, kind: '', outer: null },
  heading: { s: at('Heading here'), e: at('Heading here') + 12, kind: 'h', outer: null },
  cell: { s: at('port |', '| ----'), e: at('port |', '| ----') + 4, kind: 't', outer: null },
  cellCode: { s: at('4321'), e: at('4321') + 4, kind: 'ct', outer: { s: at('`4321`'), e: at('`4321`') + 6 } },
  quote: { s: at('Quote one'), e: PAGE.length - 1, kind: '', outer: null },
  title: { s: at('Sample page'), e: at('Sample page') + 11, kind: 'y', outer: null },
};
const ALLOWED = new Map(Object.values(R).map((r) => [`${r.s}-${r.e}`, r]));
const change = (r, before, after) => ({ s: r.s, e: r.e, before, after });
const apply = (...edits) => applyEdits(PAGE, edits, ALLOWED);

test('applyEdits: a word changed, the rest of the file byte for byte', () => {
  const r = apply(change(R.move, ' move, see ', ' step, see '));
  assert.equal(r.changed, 1);
  assert.equal(r.text, PAGE.replace(' move, see', ' step, see'));
  // Smart quote shown, plain quote in the file; typing a plain one changes nothing
  assert.equal(apply(change(R.first, 'It’s a ', 'It’s the ')).text, PAGE.replace("It's a ", "It's the "));
  assert.equal(apply(change(R.first, 'It’s a ', "It's a ")).text, PAGE, 'same text: same file');
  // Two at once
  const two = apply(change(R.move, ' move, see ', ' turn, see '), change(R.heading, 'Heading here', 'New heading'));
  assert.equal(two.changed, 2);
  assert.equal(two.text, PAGE.replace(' move,', ' turn,').replace('## Heading here', '## New heading'));
  // The next line of a quote keeps its >
  assert.equal(apply(change(R.quote, 'Quote one\nquote two', 'Quote one\nquote 2')).text, PAGE.replace('> quote two', '> quote 2'));
  // An emoji changed: never half of one
  const emoji = applyEdits('Hi 😀 there', [{ s: 0, e: 11, before: 'Hi 😀 there', after: 'Hi 😁 there' }],
    new Map([['0-11', { s: 0, e: 11, kind: '', outer: null }]]));
  assert.equal(emoji.text, 'Hi 😁 there');
});

test('applyEdits: typed Markdown stays text; code, cells, headings, line starts', () => {
  assert.equal(apply(change(R.move, ' move, see ', ' *move*, see ')).text, PAGE.replace(' move,', ' \\*move\\*,'));
  assert.equal(apply(change(R.code, 'port 80', 'port 8080')).text, PAGE.replace('`port 80`', '`port 8080`'));
  assert.equal(apply(change(R.code, 'port 80', 'port *80*')).text, PAGE.replace('`port 80`', '`port *80*`'), 'no escapes in code');
  assert.equal(apply(change(R.code, 'port 80', 'port `80`')).error, 'code');
  assert.equal(apply(change(R.cell, 'port', 'po|rt')).text, PAGE.replace('| port |', '| po\\|rt |'));
  assert.equal(apply(change(R.cellCode, '4321', '43|21')).text, PAGE.replace('`4321`', '`43\\|21`'));
  assert.equal(apply(change(R.heading, 'Heading here', 'Heading #1')).text, PAGE.replace('## Heading here', '## Heading \\#1'));
  assert.equal(apply(change(R.first, 'It’s a ', '# It’s a ')).text, PAGE.replace("It's a ", "\\# It's a "), 'no heading');
  // Deleting the start of a line: what follows must not become a list
  assert.equal(apply(change(R.version, 'Version 1. Then more.', '1. Then more.')).text, PAGE.replace('Version 1.', '1\\.'));
  assert.equal(applyEdits('Note \\{x\\}', [{ s: 0, e: 10, before: 'Note {x}', after: 'Note {y}' }],
    new Map([['0-10', { s: 0, e: 10, kind: '', outer: null }]]), { mdx: true }).text, 'Note \\{y\\}', 'escaped braces kept');
  assert.equal(applyEdits('Note x', [{ s: 0, e: 6, before: 'Note x', after: 'Note {x}' }],
    new Map([['0-6', { s: 0, e: 6, kind: '', outer: null }]]), { mdx: true }).text, 'Note \\{x\\}', 'MDX braces');
});

test('applyEdits: emptied bold / code removed whole; bold keeps its ends; the title', () => {
  assert.equal(apply(change(R.bold, 'bold', '')).text, PAGE.replace('**bold** ', ' '));
  assert.equal(apply(change(R.bold, 'bold', '  ')).text, PAGE.replace('**bold** ', ' '));
  assert.equal(apply(change(R.bold, 'bold', ' bolder ')).text, PAGE.replace('**bold**', '**bolder**'));
  assert.equal(apply(change(R.code, 'port 80', '')).text, PAGE.replace('`port 80`', ''));
  assert.equal(apply(change(R.title, 'Sample page', 'Sample: page')).text, PAGE.replace('title: Sample page', 'title: "Sample: page"'));
  assert.equal(apply(change(R.title, 'Sample page', 'Better page')).text, PAGE.replace('Sample page', 'Better page'));
  assert.equal(apply(change(R.title, 'Sample page', '  ')).error, 'title');
});

test('applyEdits: refused, all or nothing', () => {
  assert.equal(apply({ s: 0, e: 3, before: '---', after: 'x' }).error, 'bad', 'a range the build did not mark');
  assert.equal(apply(change(R.move, ' moved, see ', ' x ')).error, 'changed', 'before does not match the file');
  assert.equal(apply(change(R.move, ' move, see ', ' x '), { s: 1, e: 2, before: 'a', after: 'b' }).error, 'bad', 'one bad: none applied');
  assert.equal(apply(change(R.move, ' move, see ', ' a, see '), change(R.move, ' move, see ', ' b, see ')).error, 'bad', 'twice');
  assert.equal(applyEdits(PAGE, [], ALLOWED).error, 'bad');
  assert.equal(apply({ s: R.move.s, e: R.move.e, before: 1, after: 'x' }).error, 'bad');
  // The part an emptied text removes may not overlap another change
  const allowed = new Map([['0-3', { s: 0, e: 3, kind: 'e', outer: { s: 0, e: 6 } }], ['4-6', { s: 4, e: 6, kind: '', outer: null }]]);
  assert.equal(applyEdits('abc de', [{ s: 0, e: 3, before: 'abc', after: '' }, { s: 4, e: 6, before: 'de', after: 'x' }], allowed).error, 'bad');
  assert.deepEqual(apply(change(R.move, ' move, see ', ' move, see ')), { text: PAGE, changed: 0 });
});

// --- The build plugin (Sätteri's context faked) ---------------------------------------------------
const FILE = '---\ntitle: T\n---\n\nSee **this** and `code`.\n\n| a |\n| - |\n| cell |\n\n## Head\n';
const BODY = FILE.slice(FILE.indexOf('See')).trimEnd();
function fakeTree() {
  const pos = (piece, len = piece.length, from = 0) => {
    const s = BODY.indexOf(piece, from);
    return { start: { offset: s }, end: { offset: s + len } };
  };
  const text = (value, position) => ({ type: 'text', value, position });
  const el = (tagName, children, position) => ({ type: 'element', tagName, children, position });
  const see = text('See ', pos('See '));
  const bold = text('this', pos('this'));
  const strong = el('strong', [bold], pos('**this**'));
  const code = text('code', pos('`code`'));
  const codeEl = el('code', [code], pos('`code`'));
  const cell = text('cell', pos('cell'));
  const td = el('td', [cell]);
  const head = text('Head', pos('Head'));
  const h2 = el('h2', [head]);
  const block = text('const x = 1;', { start: { offset: 0 }, end: { offset: 12 } });
  const pre = el('pre', [el('code', [block])]);
  const odd = text('Not in the file', pos('See '));
  const p = el('p', [see, strong, codeEl, odd]);
  const root = { type: 'root', children: [p, el('table', [el('tr', [td])]), h2, pre] };
  const parents = new Map();
  const walk = (n) => n.children?.forEach((c) => { parents.set(c, n); walk(c); });
  walk(root);
  return { see, bold, code, cell, head, block, odd, ctx: { parent: (n) => parents.get(n) } };
}

test('editableProps: file offsets, kinds, the part removed when emptied, skipped text', () => {
  const base = bodyOffset(FILE, BODY);
  const n = fakeTree();
  const props = (node) => editableProps(node, n.ctx, FILE, base);
  const range = (piece) => `${FILE.indexOf(piece)}-${FILE.indexOf(piece) + piece.length}`;
  assert.deepEqual(props(n.see), { dataKitSrc: range('See ') });
  assert.deepEqual(props(n.bold), { dataKitSrc: range('this'), dataKitKind: 'e', dataKitOuter: range('**this**') });
  assert.deepEqual(props(n.code), { dataKitSrc: range('code'), dataKitKind: 'c', dataKitOuter: range('`code`') });
  assert.deepEqual(props(n.cell), { dataKitSrc: range('cell'), dataKitKind: 't' });
  assert.deepEqual(props(n.head), { dataKitSrc: range('Head'), dataKitKind: 'h' });
  assert.equal(props(n.block), null, 'code blocks are not editable');
  assert.equal(props(n.odd), null, 'text the file does not hold that way');
  assert.equal(editableProps({ type: 'text', value: 'x' }, n.ctx, FILE, base), null, 'no position');
});

test('pageEditPlugin: per Markdown page, wraps editable text in a span', (t) => {
  const D = tempDir(t);
  const md = join(D, 'page.md');
  writeFileSync(md, FILE);
  const plugin = pageEditPlugin({ fileURL: pathToFileURL(md), source: BODY });
  assert.equal(plugin.name, 'kit-page-edit');
  assert.deepEqual(plugin.options, { position: true });
  const n = fakeTree();
  const wrapped = [];
  plugin.text(n.bold, { ...n.ctx, wrapNode: (node, wrapper) => wrapped.push([node, wrapper]) });
  plugin.text(n.block, { ...n.ctx, wrapNode: (node, wrapper) => wrapped.push([node, wrapper]) });
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0][1].tagName, 'span');
  assert.equal(wrapped[0][1].properties.dataKitKind, 'e');
  assert.equal(pageEditPlugin({ fileURL: pathToFileURL(join(D, 'x.astro')), source: BODY }), null, 'not Markdown');
  assert.equal(pageEditPlugin({ fileURL: pathToFileURL(md), source: 'not in the file' }), null, 'source not found');
  assert.equal(pageEditPlugin({ source: BODY }), null, 'no file');
});

// --- The browser's helpers ------------------------------------------------------------------------
test('browser helpers: ranges, the changes sent, paste, labels in both languages', () => {
  assert.deepEqual(parseRange('12-30'), { s: 12, e: 30 });
  for (const bad of ['30-12', '5-5', 'x', '', undefined, '1-2-3']) assert.equal(parseRange(bad), null, String(bad));
  assert.deepEqual(collectEdits([
    { range: '1-4', before: 'abc', after: 'abd' }, { range: '5-8', before: 'same', after: 'same' }, { range: 'x', before: 'a', after: 'b' },
  ]), [{ s: 1, e: 4, before: 'abc', after: 'abd' }]);
  assert.equal(cleanPaste('one\r\n  two\n\nthree\tfour'), 'one two three four');
  const en = labels(false), fr = labels(true);
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  assert.deepEqual(Object.keys(en.errors).sort(), Object.keys(fr.errors).sort());
  assert.equal(en.change(1), '1 change');
  assert.equal(fr.change(3), '3 modifications');
  assert.equal(errorMessage('changed', false), en.errors.changed);
  assert.equal(errorMessage('whatever', true), fr.errors.failed);
  assert.equal(savedMessage({ version: 'abc1234' }, false), 'Saved (version abc1234)');
  assert.equal(savedMessage({ version: '', warning: 'git' }, true), fr.savedNoGit);
});

// --- The docs server ------------------------------------------------------------------------------
test('server settings, Host and Origin checks, the built page read', () => {
  assert.deepEqual(editSettings('DOCS_PORT=4321\nDOCS_EDIT=off\nDOCS_EDIT=on\n'), { edit: true, hosts: [] });
  assert.deepEqual(editSettings('DOCS_EDIT=yes\nDOCS_EDIT_HOSTS=Docs.Lan, wiki\n'), { edit: false, hosts: ['docs.lan', 'wiki'] });
  assert.deepEqual(editSettings(undefined), { edit: false, hosts: [] });
  assert.equal(hostName('[::1]:4321'), '::1');
  assert.equal(hostName('Example.Org:80'), 'example.org');
  for (const ok of ['192.0.2.7:4321', '[::1]:4321', 'localhost:4321', '127.0.0.1']) assert.equal(hostAllowed(ok), true, ok);
  for (const no of ['evil.example:4321', '', undefined, 'docs.lan']) assert.equal(hostAllowed(no), false, String(no));
  assert.equal(hostAllowed('docs.lan:4321', ['docs.lan']), true);
  assert.equal(sameOrigin('http://192.0.2.7:4321', '192.0.2.7:4321'), true);
  assert.equal(sameOrigin('http://evil.example', '192.0.2.7:4321'), false);
  assert.equal(sameOrigin(undefined, '192.0.2.7:4321'), false);
  assert.equal(sameOrigin('null', '192.0.2.7:4321'), false);
  const env = toolEnv({ PATH: '/usr/bin' });
  assert.ok(env.HOME && env.PATH.endsWith('/usr/bin') && env.PATH.includes(dirname(process.execPath)));

  const html = `<h1 id="_top">A &amp; B</h1><kit-page-edit data-file="src/content/docs/a.md" data-hash="${'a'.repeat(64)}"`
    + ' data-page-title="A &amp; B" data-title-src="11-16" data-lang="en"><p><span data-kit-src="20-25">x</span>'
    + '<strong><span data-kit-src="27-31" data-kit-kind="ey" data-kit-outer="25-33">y</span></strong></p>';
  const info = pageInfo(html);
  assert.equal(info.file, 'src/content/docs/a.md');
  assert.equal(info.title, 'A & B');
  assert.deepEqual([...info.allowed.entries()], [
    ['20-25', { s: 20, e: 25, kind: '', outer: null }],
    ['27-31', { s: 27, e: 31, kind: 'e', outer: { s: 25, e: 33 } }],
    ['11-16', { s: 11, e: 16, kind: 'y', outer: null }],
  ]);
  assert.equal(pageInfo('<p>no editing</p>'), null);
  assert.equal(pageInfo('<kit-page-edit data-file="a.md" data-hash="short">'), null);
});

// A project with one page, its built HTML (spans as the build makes them) and a docs server
function project(t, { edit = 'on' } = {}) {
  const P = tempDir(t);
  git(P, 'init', '-q', '-b', 'main');
  const docs = join(P, 'docs');
  mkdirSync(join(docs, 'src/content/docs'), { recursive: true });
  const page = join(docs, 'src/content/docs/page.md');
  const text = '---\ntitle: My page\n---\n\nHello world, this is **bold**.\n';
  writeFileSync(page, text);
  writeFileSync(join(P, '.gitignore'), 'docs/dist/\n');
  writeFileSync(join(P, '.agentkit'), `DOCS_PORT=4321\nDOCS_EDIT=${edit}\n`);
  writeFileSync(join(P, 'other.txt'), 'other\n');
  git(P, 'add', '-A');
  git(P, 'commit', '-qm', 'start');
  const html = (file = text) => {
    const s = file.indexOf('Hello'), b = file.indexOf('bold'), t0 = file.indexOf('My page');
    return '<!doctype html><h1 id="_top">My page</h1>'
      + `<kit-page-edit data-file="src/content/docs/page.md" data-hash="${sha256(file)}" data-page-title="My page" data-title-src="${t0}-${t0 + 7}">`
      + `</kit-page-edit><div class="sl-markdown-content"><p><span data-kit-src="${s}-${b - 2}">Hello world, this is </span>`
      + `<strong><span data-kit-src="${b}-${b + 4}" data-kit-kind="e" data-kit-outer="${b - 2}-${b + 6}">bold</span></strong></p></div>`;
  };
  const writeHtml = (file) => {
    mkdirSync(join(docs, 'dist/page'), { recursive: true });
    writeFileSync(join(docs, 'dist/page/index.html'), html(file));
  };
  writeHtml(text);
  const builds = [];
  const state = { failBuild: false };
  const logs = [];
  const server = startDocsServer(join(docs, 'dist'), 0, {
    host: '127.0.0.1',
    edit: {
      build: async (root) => { builds.push(root); return { ok: !state.failBuild, output: 'build output' }; },
      log: (line) => logs.push(line),
    },
  });
  t.after(() => server.close());
  const ready = new Promise((done) => server.on('listening', done));
  const hello = { s: text.indexOf('Hello'), e: text.indexOf('bold') - 2 };
  return { P, page, text, builds, state, logs, writeHtml, ready, server, hello };
}

function send(server, { method = 'POST', path = '/_kit/edit', headers = {}, body } = {}) {
  const port = server.address().port;
  const host = `127.0.0.1:${port}`;
  const all = { host, origin: `http://${host}`, 'x-kit-edit': '1', 'content-type': 'application/json', ...headers };
  for (const [k, v] of Object.entries(all)) if (v === undefined) delete all[k];
  return new Promise((done, failed) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: all }, (res) => {
      let text = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { text += c; });
      res.on('end', () => done({ status: res.statusCode, json: text ? JSON.parse(text) : null }));
    });
    req.on('error', failed);
    req.end(body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body));
  });
}
const helloEdit = (p, after = 'Hi world, this is ') => ({ page: '/page/', edits: [{ ...p.hello, before: 'Hello world, this is ', after }] });

test('server: editing on / off, a save writes the file, builds, saves only it in git', async (t) => {
  const p = project(t);
  await p.ready;
  assert.deepEqual((await send(p.server, { method: 'GET' })).json, { enabled: true });
  git(p.P, 'add', '-A');
  writeFileSync(join(p.P, 'other.txt'), 'changed but not saved\n');
  git(p.P, 'add', 'other.txt'); // staged by someone else: must stay out of the save

  const r = await send(p.server, { body: helloEdit(p) });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.equal(r.json.version, git(p.P, 'rev-parse', '--short', 'HEAD'));
  assert.equal(readFileSync(p.page, 'utf8'), p.text.replace('Hello world', 'Hi world'));
  assert.deepEqual(p.builds, [p.P]);
  assert.equal(git(p.P, 'log', '-1', '--format=%s'), 'docs: edit "My page" in the browser');
  assert.equal(git(p.P, 'show', '--name-only', '--format=', 'HEAD'), 'docs/src/content/docs/page.md');
  assert.match(git(p.P, 'status', '--porcelain'), /^M {2}other\.txt$/m, 'the other staged change is still staged');
  assert.ok(p.logs.some((l) => l.startsWith('Docs edit: docs/src/content/docs/page.md saved')));

  // The website now shows the old build (fake build): the page changed since it was built
  const again = await send(p.server, { body: helloEdit(p, 'Hey world, this is ') });
  assert.deepEqual([again.status, again.json.error], [409, 'changed']);

  // Off: GET says so, POST refused
  writeFileSync(join(p.P, '.agentkit'), 'DOCS_EDIT=off\n');
  assert.deepEqual((await send(p.server, { method: 'GET' })).json, { enabled: false });
  assert.deepEqual((await send(p.server, { body: helloEdit(p) })).json.error, 'off');
});

test('server: requests another website could make are refused, nothing written', async (t) => {
  const p = project(t);
  await p.ready;
  const port = p.server.address().port;
  const refused = [
    [{ host: `evil.example:${port}`, origin: `http://evil.example:${port}` }, 'forbidden'], // DNS rebinding
    [{ origin: 'http://evil.example' }, 'forbidden'],
    [{ origin: undefined }, 'forbidden'],
    [{ 'x-kit-edit': undefined }, 'forbidden'],
    [{ 'content-type': 'text/plain' }, 'forbidden'],
  ];
  for (const [headers, error] of refused) {
    const r = await send(p.server, { headers, body: helloEdit(p) });
    assert.deepEqual([r.status, r.json.error], [403, error], JSON.stringify(headers));
  }
  // A name listed in DOCS_EDIT_HOSTS is fine
  writeFileSync(join(p.P, '.agentkit'), 'DOCS_EDIT=on\nDOCS_EDIT_HOSTS=docs.lan\n');
  const named = await send(p.server, { headers: { host: `docs.lan:${port}`, origin: `http://docs.lan:${port}` }, body: helloEdit(p) });
  assert.equal(named.status, 200);
  assert.equal(p.builds.length, 1);
  const other = await send(p.server, { method: 'PUT' });
  assert.equal(other.status, 405);
});

test('server: unknown page, file outside the pages, unsaved file, bad changes, too big, failed build', async (t) => {
  const p = project(t);
  await p.ready;
  const expect = async (body, status, error, headers) => {
    const r = await send(p.server, { body, headers });
    assert.deepEqual([r.status, r.json?.error], [status, error], JSON.stringify(body).slice(0, 80));
  };
  await expect({ ...helloEdit(p), page: '/nope/' }, 404, 'notfound');
  await expect({ ...helloEdit(p), page: '/../../.agentkit' }, 404, 'notfound');
  await expect('not json', 400, 'bad');
  await expect({ page: '/page/' }, 400, 'bad');
  await expect({ page: '/page/', edits: [{ s: 0, e: 3, before: '---', after: 'x' }] }, 400, 'bad');
  await expect({ page: '/page/', edits: [{ ...p.hello, before: 'Something else', after: 'x' }] }, 409, 'changed');
  await expect({ page: '/page/', edits: [], pad: 'x'.repeat(1_100_000) }, 413, 'bad');

  // A built page pointing at a file outside src/content/ is never written
  const outside = readFileSync(join(p.P, 'docs/dist/page/index.html'), 'utf8').replace('src/content/docs/page.md', '../.agentkit');
  writeFileSync(join(p.P, 'docs/dist/page/index.html'), outside);
  await expect(helloEdit(p), 404, 'notfound');

  // The file has changes not saved in git (the website was built from them): refused
  const dirty = p.text.replace('bold', 'bold!');
  writeFileSync(p.page, dirty);
  p.writeHtml(dirty);
  await expect(helloEdit(p), 409, 'unsaved');
  writeFileSync(p.page, p.text);
  p.writeHtml(p.text);

  // The build fails: the file is put back, nothing saved in git
  p.state.failBuild = true;
  const head = git(p.P, 'rev-parse', 'HEAD');
  await expect(helloEdit(p), 500, 'build');
  assert.equal(readFileSync(p.page, 'utf8'), p.text);
  assert.equal(git(p.P, 'rev-parse', 'HEAD'), head);
  assert.equal(p.builds.length, 1);
  assert.ok(p.logs.some((l) => /refused \(build\)/.test(l)));
});

// --- kit docs edit --------------------------------------------------------------------------------
test('kit docs edit on / off / status: the .agentkit line, saved alone in git', (t) => {
  const P = tempDir(t);
  git(P, 'init', '-q', '-b', 'main');
  mkdirSync(join(P, 'docs'));
  writeFileSync(join(P, 'docs/package.json'), '{ "name": "docs" }\n');
  writeFileSync(join(P, '.agentkit'), 'DOCS_PORT=4399');
  writeFileSync(join(P, 'notes.txt'), 'x\n');
  git(P, 'add', '-A');
  git(P, 'commit', '-qm', 'start');
  writeFileSync(join(P, 'notes.txt'), 'unsaved\n');
  const kit = (...args) => execFileSync('bash', [join(KIT_DIR, 'bin/kit'), 'docs', 'edit', ...args], {
    cwd: P, encoding: 'utf8', env: { ...process.env, KIT_CONF: join(P, 'no-config') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.match(kit('status'), /Editing in the browser: off/);
  assert.match(kit('status'), /no Edit button yet/);
  const on = kit('on');
  assert.match(on, /EDITING ON: an Edit button is next to each page title of http:\/\/.*:4399/);
  assert.equal(readFileSync(join(P, '.agentkit'), 'utf8'), 'DOCS_PORT=4399\nDOCS_EDIT=on\n');
  assert.equal(git(P, 'log', '-1', '--format=%s'), 'docs: editing in the browser on');
  assert.equal(git(P, 'show', '--name-only', '--format=', 'HEAD'), '.agentkit');
  assert.match(git(P, 'status', '--porcelain'), /^M notes\.txt$/m, 'other changes left as they were (not saved)');
  assert.match(kit('status'), /Editing in the browser: ON/);
  assert.match(kit('off'), /EDITING OFF/);
  assert.equal(readFileSync(join(P, '.agentkit'), 'utf8'), 'DOCS_PORT=4399\nDOCS_EDIT=off\n');
  assert.throws(() => kit('maybe'), /Usage: kit docs edit on \| off \| status/);
});

// --- Templates and kit docs upgrade ---------------------------------------------------------------
test('template: the Edit button, its bar and what it sends; marked files; no addresses', () => {
  const config = readFileSync(join(TEMPLATE, 'astro.config.mjs'), 'utf8');
  assert.ok(usesKitPageEdit(config));
  assert.match(config, /^import pageEdit from '\.\/src\/page-edit\/page-edit\.mjs';$/m);
  assert.ok(config.indexOf('pageEdit(),') < config.indexOf('starlight({'), 'before starlight');
  const title = readFileSync(join(TEMPLATE, 'src/components/PageTitle.astro'), 'utf8');
  assert.ok(title.includes("import PageEdit from './PageEdit.astro'") && /<PageEdit \/>\s*<PageActions \/>/.test(title));
  const edit = readFileSync(join(TEMPLATE, 'src/components/PageEdit.astro'), 'utf8');
  for (const needed of ["const editableMode = 'true'", "'insertParagraph'", "'insertLineBreak'", "startsWith('format')", "execCommand('insertText'",
    "'x-kit-edit': '1'", "'content-type': 'application/json'", 'location.pathname', 'location.reload()', "'beforeunload'",
    'span[data-kit-src]', "getElementById('_top')", 'createHash(\'sha256\')', 'titleRange(', 'data-hash={hash}', 'cache: \'no-store\'',
    "answer?.enabled === true", 'sessionStorage', '@media print', 'kit-editing', 'prefers-reduced-motion']) {
    assert.ok(edit.includes(needed), needed);
  }
  // Changed text has no colour of its own; editing adds no space under the page (no scrollbar)
  assert.ok(!edit.includes('kit-edit-changed'), 'no changed-text highlight');
  assert.doesNotMatch(edit, /kit-editing body \{[^}]*padding-bottom/, 'no space added under the page');
  assert.match(edit, /:root\.kit-editing \{\s*scroll-padding-bottom: 6rem;/);
  // The bar is centred on the window, not on the part right of the sidebar
  const barRule = /\n\t\.kit-edit-bar \{([^}]*)\}/.exec(edit)[1];
  assert.match(barRule, /inset-inline: 1rem;/);
  assert.ok(!barRule.includes('--sl-content-inline-start'));
  for (const rel of [...KIT_PAGE_EDIT.files, 'src/components/PageEdit.astro', 'src/scripts/page-edit.mjs']) {
    const text = readFileSync(join(TEMPLATE, rel), 'utf8');
    assert.ok(text.includes(MARKER), `${rel} marker`);
    assert.doesNotMatch(text, /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/, `${rel} has an IP address`);
    assert.ok(KIT_COMPONENTS.PageTitle.files.includes(rel) || KIT_PAGE_EDIT.files.includes(rel), `${rel} copied by the upgrade`);
  }
  const plugin = readFileSync(join(TEMPLATE, 'src/page-edit/page-edit.mjs'), 'utf8');
  assert.ok(plugin.includes("'satteri'") && plugin.includes('hastPlugins') && plugin.includes('wrapNode'));
  const serve = readFileSync(join(KIT_DIR, 'lib/docs-serve.mjs'), 'utf8');
  assert.ok(serve.includes('realpathSync(process.argv[1])'), 'runs when started through a link');
});

test('upgradeDocs: the Edit button added to an older site once; kit docs upgrade clears the rendered pages', (t) => {
  const D = tempDir(t);
  mkdirSync(join(D, 'src/content/docs'), { recursive: true });
  writeFileSync(join(D, 'package.json'), '{ "name": "docs", "dependencies": { "pele": "^1.8.0" } }\n');
  const older = readFileSync(join(TEMPLATE, 'astro.config.mjs'), 'utf8')
    .replace(/^import pageEdit from .*\n/m, '').replace(/^ {4}pageEdit\(\),.*\n/m, '');
  writeFileSync(join(D, 'astro.config.mjs'), older);
  writeFileSync(join(D, 'src/content/docs/index.md'), '---\ntitle: Home\n---\n\nText.\n');
  const r = upgradeDocs(D, TEMPLATE);
  assert.equal(r.problem, '');
  assert.ok(r.changed.includes('astro.config.mjs: page text editable in the browser (pageEdit(); kit docs edit on)'));
  assert.equal(readFileSync(join(D, 'astro.config.mjs'), 'utf8'), readFileSync(join(TEMPLATE, 'astro.config.mjs'), 'utf8'));
  for (const rel of ['src/components/PageEdit.astro', 'src/scripts/page-edit.mjs', ...KIT_PAGE_EDIT.files]) {
    assert.equal(readFileSync(join(D, rel), 'utf8'), readFileSync(join(TEMPLATE, rel), 'utf8'), rel);
  }
  assert.ok(!upgradeDocs(D, TEMPLATE).changed.some((l) => l.includes('pageEdit')), 'once');

  // The real command: Astro's cache of rendered pages is removed, so every page gets its spans
  const P = tempDir(t);
  git(P, 'init', '-q', '-b', 'main');
  mkdirSync(join(P, 'docs/node_modules/.astro'), { recursive: true });
  writeFileSync(join(P, 'docs/package.json'), '{ "name": "docs", "dependencies": { "pele": "^1.8.0" } }\n');
  writeFileSync(join(P, 'docs/astro.config.mjs'), older);
  writeFileSync(join(P, 'docs/node_modules/.astro/data-store.json'), '{}');
  execFileSync('bash', [join(KIT_DIR, 'bin/kit'), 'docs', 'upgrade'], {
    cwd: P, encoding: 'utf8', env: { ...process.env, KIT_CONF: join(P, 'no-config') }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(existsSync(join(P, 'docs/node_modules/.astro/data-store.json')), false);
  assert.ok(existsSync(join(P, 'docs/src/page-edit/page-edit.mjs')));
});

// --- Renamed headings: the links to their sections -----------------------------------------------
test('links: page addresses, links resolved, heading ids, renamed sections', () => {
  assert.equal(pageUrl('/a/b/index.html'), '/a/b/');
  assert.equal(pageUrl('/a/b'), '/a/b/');
  assert.equal(pageUrl('/index.html'), '/');
  assert.equal(pageUrl('/page.md'), '/page.md');
  assert.deepEqual(resolveLink('../a/#table', '/b/c/'), { href: '../a/#table', path: '/b/a/', fragment: 'table' });
  assert.deepEqual(resolveLink('#x', '/b/'), { href: '#x', path: '/b/', fragment: 'x' });
  assert.deepEqual(resolveLink('/a#r%C3%A9seau', '/'), { href: '/a#r%C3%A9seau', path: '/a/', fragment: 'réseau' });
  for (const out of ['https://x.example/#a', 'mailto:me@x.example', '//x.example/a', '']) assert.equal(resolveLink(out, '/'), null, out);
  assert.deepEqual(headingIds('<h1 id="_top">T</h1><h2 id="a">A</h2><p id="no">x</p><h3 class="x" id="b-1">B</h3>'), ['_top', 'a', 'b-1']);
  assert.deepEqual([...renamedSections(['_top', 'table', 'lists'], ['_top', 'service-table', 'lists'])], [['table', 'service-table']]);
  // Two "Setup" headings: renaming the first moves the second's id
  assert.deepEqual([...renamedSections(['setup', 'setup-1'], ['install', 'setup'])], [['setup', 'install'], ['setup-1', 'setup']]);
  assert.equal(renamedSections(['a'], ['a', 'b']).size, 0, 'different headings: no guess');
});

test('links: page text links apart from the sidebar, "On this page" and the # next to headings', () => {
  const html = '<nav><a href="/side/#s">side</a></nav><starlight-toc><a href="#t">t</a></starlight-toc>'
    + '<mobile-starlight-toc><a href="#t">t</a></mobile-starlight-toc><main><div class="sl-markdown-content">'
    + '<h2 id="t">T</h2><a class="sl-anchor-link" href="#t">#</a><a href="/other/#x">x</a><a href="https://e.example/">e</a>'
    + '</div><footer><a href="/next/">next</a></footer></main>';
  assert.deepEqual(contentLinks(html, '/p/').map((l) => l.href), ['/other/#x']);
  assert.deepEqual(pageLinks(html, '/p/').map((l) => l.href), ['/side/#s', '/other/#x', '/next/']);
  const site = new Map([
    ['/p/', { ids: new Set(['t']), all: [resolveLink('/q/#gone', '/p/'), resolveLink('/q/#here', '/p/'), resolveLink('/none/', '/p/'), resolveLink('/q.md', '/p/')] }],
    ['/q/', { ids: new Set(['here']), all: [resolveLink('#_top', '/q/')] }],
  ]);
  assert.deepEqual([...brokenLinks(site)], ['/p/|/q/#gone', '/p/|/none/']);
});

test('rewriteSectionLinks: every way of writing a link to the renamed section, nothing else', () => {
  const renamed = new Map([['table', 'service-table'], ['setup', 'install']]);
  const text = [
    'See [the table](/a/#table), [again](/a#table "with a title"), [up](../a/#table) and <a href="/a/#table">html</a>.',
    '[ref]: /a/#table',
    'Not this: [other page](/b/#table), [other section](/a/#lists), [outside](https://x.example/a/#table).',
    '```md',
    '[in a code block](/a/#table)',
    '```',
    'Same page from a: [here](#setup).',
  ].join('\n');
  const r = rewriteSectionLinks(text, '/c/', '/a/', renamed);
  assert.equal(r.count, 5);
  assert.equal(r.text, text.replace(/\/a\/#table\)/, '/a/#service-table)').replace('/a#table "', '/a#service-table "')
    .replace('../a/#table)', '../a/#service-table)').replace('href="/a/#table"', 'href="/a/#service-table"')
    .replace('[ref]: /a/#table', '[ref]: /a/#service-table'));
  const self = rewriteSectionLinks(text, '/a/', '/a/', renamed);
  assert.ok(self.text.includes('[here](#install)'), 'a link to a section of the same page');
  assert.equal(rewriteSectionLinks('[x](/a/#table)', '/c/', '/a/', new Map()).count, 0);
});

// A docs project with Markdown pages and a fake build that writes their "built" HTML: headings with
// ids (numbered when repeated), editable heading text, links, a sidebar
function linkedSite(t, { pages, sidebar = [] }) {
  const P = tempDir(t);
  git(P, 'init', '-q', '-b', 'main');
  const docs = join(P, 'docs');
  const content = join(docs, 'src/content/docs');
  mkdirSync(content, { recursive: true });
  for (const [name, text] of Object.entries(pages)) writeFileSync(join(content, `${name}.md`), text);
  writeFileSync(join(P, '.gitignore'), 'docs/dist/\n');
  writeFileSync(join(P, '.agentkit'), 'DOCS_EDIT=on\n');
  git(P, 'add', '-A');
  git(P, 'commit', '-qm', 'start');
  const slug = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-');
  const builds = [];
  const build = async () => {
    builds.push(Date.now());
    for (const name of Object.keys(pages)) {
      const text = readFileSync(join(content, `${name}.md`), 'utf8');
      const used = new Map();
      let body = '';
      let at = text.indexOf('\n---\n') + 5;
      for (const line of text.slice(at).split('\n')) {
        const h = /^## (.+)$/.exec(line);
        if (h) {
          const base = slug(h[1]);
          const n = used.get(base) ?? 0;
          used.set(base, n + 1);
          const id = n ? `${base}-${n}` : base;
          body += `<h2 id="${id}"><span data-kit-src="${at + 3}-${at + line.length}" data-kit-kind="h">${h[1]}</span></h2><a class="sl-anchor-link" href="#${id}">#</a>`;
        } else {
          body += `<p>${line.replace(/\[([^\]]+)\]\(([^)\s]+)[^)]*\)/g, '<a href="$2">$1</a>')}</p>`;
        }
        at += line.length + 1;
      }
      const html = `<!doctype html><nav>${sidebar.map((h) => `<a href="${h}">s</a>`).join('')}</nav><main><h1 id="_top">${name}</h1>`
        + `<kit-page-edit data-file="src/content/docs/${name}.md" data-hash="${sha256(text)}" data-page-title="${name}"></kit-page-edit>`
        + `<div class="sl-markdown-content">${body}</div><footer></footer></main>`;
      mkdirSync(join(docs, 'dist', name), { recursive: true });
      writeFileSync(join(docs, 'dist', name, 'index.html'), html);
    }
    return { ok: true, output: '' };
  };
  const server = startDocsServer(join(docs, 'dist'), 0, { host: '127.0.0.1', edit: { build, log: () => {} } });
  t.after(() => server.close());
  const ready = build().then(() => new Promise((done) => server.on('listening', done)));
  const read = (name) => readFileSync(join(content, `${name}.md`), 'utf8');
  // The edit of a heading, as the browser sends it
  const rename = (name, from, to) => {
    const text = read(name);
    const s = text.indexOf(`## ${from}\n`) + 3;
    return { page: `/${name}/`, edits: [{ s, e: s + from.length, before: from, after: to }] };
  };
  return { P, server, ready, builds, read, rename };
}

const PAGE_A = '---\ntitle: a\n---\n## Table\nSee [lists](#lists-here) and [the part](/b/#part).\n## Lists here\nEnd.\n## Notes\n';
const PAGE_B = '---\ntitle: b\n---\n## Part\nBack to [the table](/a/#table), [again](../a/#table "title"), [lists](/a/#lists-here).\n';

test('server: a renamed heading updates the links to its section, in one git version', async (t) => {
  const s = linkedSite(t, { pages: { a: PAGE_A, b: PAGE_B } });
  await s.ready;
  const r = await send(s.server, { body: s.rename('a', 'Table', 'Service table') });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual([r.json.links, r.json.pages], [2, 1]);
  assert.equal(s.read('a'), PAGE_A.replace('## Table', '## Service table'));
  assert.equal(s.read('b'), PAGE_B.replace('/a/#table)', '/a/#service-table)').replace('../a/#table "', '../a/#service-table "'));
  assert.equal(git(s.P, 'log', '-1', '--format=%s'), 'docs: edit "a" in the browser (2 links to renamed sections updated)');
  assert.deepEqual(git(s.P, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['docs/src/content/docs/a.md', 'docs/src/content/docs/b.md']);
  assert.equal(git(s.P, 'status', '--porcelain'), '', 'nothing left unsaved');
  assert.deepEqual(brokenLinks(await siteLinks(join(s.P, 'docs/dist'))), new Set(), 'no broken link');

  // A link to a section of the same page is updated in the page itself
  const own = await send(s.server, { body: s.rename('a', 'Lists here', 'Lists') });
  assert.equal(own.status, 200, JSON.stringify(own.json));
  assert.ok(s.read('a').includes('[lists](#lists)') && s.read('b').includes('[lists](/a/#lists)'));
  assert.deepEqual([own.json.links, own.json.pages], [2, 1]);

  // Linked from another page only
  const part = await send(s.server, { body: s.rename('b', 'Part', 'Second part') });
  assert.deepEqual([part.status, part.json.links], [200, 1]);
  assert.ok(s.read('a').includes('[the part](/b/#second-part)'));

  // A heading nobody links to: one build, nothing else changed
  const builds = s.builds.length;
  const plain = await send(s.server, { body: s.rename('a', 'Notes', 'More notes') });
  assert.equal(plain.status, 200);
  assert.equal(plain.json.links, undefined);
  assert.equal(s.builds.length, builds + 1);
  assert.equal(git(s.P, 'show', '--name-only', '--format=', 'HEAD'), 'docs/src/content/docs/a.md');
});

test('server: a link that can\'t be updated (sidebar, unsaved page) -> refused, files and website back', async (t) => {
  const s = linkedSite(t, { pages: { a: PAGE_A, b: PAGE_B }, sidebar: ['/a/#table'] });
  await s.ready;
  const head = git(s.P, 'rev-parse', 'HEAD');
  const r = await send(s.server, { body: s.rename('a', 'Table', 'Service table') });
  assert.deepEqual([r.status, r.json.error], [409, 'links']);
  assert.ok(r.json.detail.some((d) => d.includes('/a/#table') && d.includes('sidebar')), JSON.stringify(r.json.detail));
  assert.equal(s.read('a'), PAGE_A);
  assert.equal(s.read('b'), PAGE_B);
  assert.equal(git(s.P, 'rev-parse', 'HEAD'), head);
  assert.ok(readFileSync(join(s.P, 'docs/dist/a/index.html'), 'utf8').includes('<h2 id="table">'), 'website built again from the files');

  const u = linkedSite(t, { pages: { a: PAGE_A, b: PAGE_B } });
  await u.ready;
  writeFileSync(join(u.P, 'docs/src/content/docs/b.md'), `${PAGE_B}\nNot saved yet.\n`);
  const dirty = await send(u.server, { body: u.rename('a', 'Table', 'Service table') });
  assert.deepEqual([dirty.status, dirty.json.error], [409, 'links']);
  assert.ok(dirty.json.detail.every((d) => d.includes('changes not saved in git')), JSON.stringify(dirty.json.detail));
  assert.equal(u.read('a'), PAGE_A);
  assert.equal(u.read('b'), `${PAGE_B}\nNot saved yet.\n`, 'the unsaved changes are left as they were');
});

test('browser helpers: the links messages', () => {
  assert.equal(errorMessage('links', false, ['b → /a/#table (sidebar)']), `${labels(false).errors.links} b → /a/#table (sidebar)`);
  assert.equal(errorMessage('links', true), labels(true).errors.links);
  assert.equal(savedMessage({ version: 'abc1234', links: 3 }, false), 'Saved (version abc1234) · 3 links to the renamed sections updated');
  assert.equal(savedMessage({ version: 'abc1234', links: 1 }, true), 'Enregistré (version abc1234) · 1 lien vers la section renommée mis à jour');
});
