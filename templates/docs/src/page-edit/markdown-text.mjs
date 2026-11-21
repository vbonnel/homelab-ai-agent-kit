// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// A page's text as its Markdown file holds it, for changing the text in the browser (the Edit
// button next to the page title, components/PageEdit.astro). The website build marks the text
// that can be changed (page-edit.mjs); the docs server of the agent kit saves a change with
// applyEdits (it uses the kit's own copy of this file, never the website's). No packages.

// Where the shown text comes from. Markdown shows some characters differently from the file:
// smart punctuation, backslash escapes, HTML entities, and the `>` / indentation that starts the
// next line of a quote or a list item. alignText(source, shown) lines the two up: for each
// position of the shown text (0..length), the position in the source; null when the source does
// not hold the shown text that way (that text is then not editable).
const SMART = { '’': "'", '‘': "'", '“': '"', '”': '"', '—': '---', '–': '--', '…': '...' };
const PUNCTUATION = '!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~';
const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', shy: '­', copy: '©', reg: '®',
  trade: '™', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', sbquo: '‚', bdquo: '„', times: '×', divide: '÷', deg: '°', plusmn: '±',
  middot: '·', bull: '•', euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶',
  larr: '←', rarr: '→', uarr: '↑', darr: '↓', harr: '↔', lArr: '⇐', rArr: '⇒', hArr: '⇔',
  le: '≤', ge: '≥', ne: '≠', asymp: '≈', infin: '∞', check: '✓', zwj: '‍', zwnj: '‌',
  emsp: ' ', ensp: ' ', thinsp: ' ',
};
const ENTITY = /^&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{1,31});/;

export function decodeEntity(name) {
  if (name[0] !== '#') return Object.hasOwn(ENTITIES, name) ? ENTITIES[name] : null;
  const code = /^#[xX]/.test(name) ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  if (!code || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return null;
  return String.fromCodePoint(code);
}

const blank = (c) => c === ' ' || c === '\t';

export function alignText(source, shown) {
  source = String(source ?? '');
  shown = String(shown ?? '');
  const map = new Array(shown.length + 1);
  let i = 0, j = 0;
  if (!blank(shown[0])) while (blank(source[j])) j++; // spaces before the text (paragraph indent)
  while (i < shown.length) {
    map[i] = j;
    const c = shown[i];
    if (c === '\n') {
      // A line break: the spaces left before it, then the `>` and spaces starting the next line
      let k = j;
      while (blank(source[k])) k++;
      if (source[k] === '\r') k++;
      if (source[k] !== '\n') return null;
      k++;
      while (k < source.length && (blank(source[k]) || source[k] === '>') && source[k] !== shown[i + 1]) k++;
      i++;
      j = k;
      continue;
    }
    if (source[j] === '\\' && PUNCTUATION.includes(source[j + 1] ?? '')) {
      if (source[j + 1] !== c) return null; // an escape always shows the character after it
      i++;
      j += 2;
      continue;
    }
    if (source[j] === '&') {
      const m = ENTITY.exec(source.slice(j, j + 40));
      const ch = m && decodeEntity(m[1]);
      if (ch && shown.startsWith(ch, i)) {
        for (let n = 1; n < ch.length; n++) map[i + n] = j; // inside a pair of UTF-16 units
        i += ch.length;
        j += m[0].length;
        continue;
      }
    }
    if (source[j] === c) {
      i++;
      j++;
      continue;
    }
    const smart = SMART[c];
    if (smart && source.startsWith(smart, j)) {
      i++;
      j += smart.length;
      continue;
    }
    return null;
  }
  map[shown.length] = j;
  while (blank(source[j])) j++; // spaces after the text (before a line break)
  if (j !== source.length) return null;
  return map;
}

// Inline code: the source is `code` with its backticks; the range inside them that holds exactly
// the shown text ([start, end] in the source), or null.
export function codeRange(source, shown) {
  source = String(source ?? '');
  const fence = /^`+/.exec(source)?.[0];
  if (!fence || source.length < 2 * fence.length + 1 || !source.endsWith(fence)) return null;
  let a = fence.length, b = source.length - fence.length;
  if (source[a] === '`' || source[b - 1] === '`') return null;
  if (b - a >= 2 && source[a] === ' ' && source[b - 1] === ' ' && source.slice(a, b).trim()) { a++; b--; }
  return source.slice(a, b) === shown ? [a, b] : null;
}

// Where the page source Markdown got starts in the file: 0 when both are as long (the frontmatter
// was blanked), else the last place the source is found (after the frontmatter); -1 if nowhere.
export function bodyOffset(fileText, source) {
  if (typeof fileText !== 'string' || typeof source !== 'string') return -1;
  if (fileText.length === source.length) return 0;
  return source ? fileText.lastIndexOf(source) : -1;
}

// Typed text written as Markdown that shows exactly that text: never formatting. One line (line
// breaks and tabs become spaces). `code`: inside backticks, where escapes don't work (a backtick
// can't be written: null). `lineStart`: nothing but quote / list markers before it on its line.
export function escapeTyped(text, { code = false, cell = false, heading = false, mdx = false, lineStart = false } = {}) {
  const t = String(text ?? '')
    .replace(/\r\n?|[\n\t ]/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, '');
  if (code) {
    if (t.includes('`')) return null;
    return cell ? t.replace(/\|/g, '\\|') : t;
  }
  const word = (c) => !!c && /[\p{L}\p{N}]/u.test(c);
  let out = '';
  for (let k = 0; k < t.length; k++) {
    const c = t[k];
    if ('\\`*[]<~'.includes(c)) out += `\\${c}`;
    else if (c === '_') out += word(t[k - 1]) && word(t[k + 1]) ? '_' : '\\_';
    else if (c === '&') out += ENTITY.test(t.slice(k)) ? '\\&' : '&';
    else if (c === '|' && cell) out += '\\|';
    else if (c === '#' && heading) out += '\\#';
    else if ((c === '{' || c === '}') && mdx) out += `\\${c}`;
    else out += c;
  }
  return lineStart ? guardLineStart(out.replace(/^ +/, '')) : out;
}

// Text that starts a line must not start a block (heading, list, quote, rule, fence, directive):
// blockStartAt(text) -> where a backslash must go so it doesn't (-1: nothing to do). For `1.` /
// `1)` it is the dot or bracket, for the others their first character.
const BLOCK_START = /^(?:#{1,6}(?=[ \t]|$)|[-+*](?=[ \t]|$)|>|\d{1,9}(?=[.)](?:[ \t]|$))|:::|=+[ \t]*$|-{3,}|\*{3,}|_{3,}|`{3}|~{3})/;
export function blockStartAt(text) {
  const lead = /^[ \t]*/.exec(text)[0].length;
  const rest = text.slice(lead);
  const m = BLOCK_START.exec(rest);
  if (!m) return -1;
  return lead + (/^\d/.test(rest) ? m[0].length : 0);
}
export function guardLineStart(text) {
  const at = blockStartAt(text);
  return at < 0 ? text : `${text.slice(0, at)}\\${text.slice(at)}`;
}

// Is `offset` at the start of a line's text: only spaces, quote markers and list markers before it?
const LINE_PREFIX = /^[ \t]*(?:>[ \t]?)*[ \t]*(?:(?:[-+*]|\d{1,9}[.)])[ \t]+(?:>[ \t]?)*)*[ \t]*$/;
export function atLineStart(text, offset) {
  const from = text.lastIndexOf('\n', offset - 1) + 1;
  return LINE_PREFIX.test(text.slice(from, offset));
}

// The page title: the `title:` line of the frontmatter (one line: plain, 'single' or "double"
// quoted). { s, e, value } (s-e: the value as written, quotes included), or null.
export function titleRange(fileText) {
  const text = String(fileText ?? '');
  const bom = text.startsWith('﻿') ? 1 : 0;
  const head = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text.slice(bom));
  if (!head) return null;
  const startOfBlock = bom + head[0].indexOf(head[1]);
  const line = /^title:[ \t]*(\S(?:.*\S)?)[ \t]*\r?$/m.exec(head[1]);
  if (!line) return null;
  const raw = line[1];
  const value = yamlValue(raw);
  if (value === null) return null;
  const s = startOfBlock + line.index + line[0].indexOf(raw, 'title:'.length);
  return { s, e: s + raw.length, value };
}

// One YAML scalar on one line -> its value (null when it is not a simple one)
export function yamlValue(raw) {
  if (raw.startsWith('"')) {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(raw)) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  if (raw.startsWith("'")) return /^'(?:[^']|'')*'$/.test(raw) ? raw.slice(1, -1).replace(/''/g, "'") : null;
  if (/^[>|&*!%@`{[\]]/.test(raw) || /\s#/.test(raw) || /:(\s|$)/.test(raw)) return null;
  return raw;
}

// A new title written like the old one: plain when that is safe, else in quotes
export function yamlScalar(value, like = '') {
  const v = String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  if (like.startsWith("'")) return `'${v.replace(/'/g, "''")}'`;
  const plainSafe = v && !/^[-?:,[\]{}#&*!|>'"%@`\s]/.test(v) && !/:(\s|$)/.test(v) && !/\s#/.test(v)
    && !/^(?:true|false|yes|no|on|off|null|~|[-+]?(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?|\d{4}-\d\d-\d\d.*)$/i.test(v);
  return !like.startsWith('"') && plainSafe ? v : JSON.stringify(v);
}

const fail = (error, message) => ({ error, message });

// One change of one range -> { part: { from, to, text } } (null part: nothing to change) or an error
function editPart(fileText, range, before, after, mdx) {
  const source = fileText.slice(range.s, range.e);
  const kind = range.kind || '';
  if (kind.includes('y')) {
    if (yamlValue(source) !== before) return fail('changed', 'The page changed since it was opened.');
    const title = after.replace(/\s+/g, ' ').trim();
    if (!title) return fail('title', 'A page needs a title.');
    if (title === before) return { part: null };
    return { part: { from: range.s, to: range.e, text: yamlScalar(title, source) } };
  }
  const code = kind.includes('c');
  const map = code ? (source === before ? [...Array(before.length + 1).keys()] : null) : alignText(source, before);
  if (!map) return fail('changed', 'The page changed since it was opened.');
  let next = after;
  if (kind.includes('e')) next = next.trim(); // spaces at the ends would undo the bold / italic
  if (next === before) return { part: null };
  if (!next.trim() && range.outer) return { part: { from: range.outer.s, to: range.outer.e, text: '' } };

  // Only the part between the common start and end is written
  const most = Math.min(before.length, next.length);
  let p = 0;
  while (p < most && before[p] === next[p]) p++;
  let q = 0;
  while (q < most - p && before[before.length - 1 - q] === next[next.length - 1 - q]) q++;
  const high = (s, at) => /[\ud800-\udbff]/.test(s[at] ?? '');
  if (p > 0 && high(before, p - 1)) p--; // never between the two halves of an emoji
  if (q > 0 && high(before, before.length - q - 1)) q--;
  const from = range.s + map[p];
  const to = range.s + map[before.length - q];
  const lineStart = !code && atLineStart(fileText, from);
  const typed = escapeTyped(next.slice(p, next.length - q), {
    code, cell: kind.includes('t'), heading: kind.includes('h'), mdx, lineStart,
  });
  if (typed === null) return fail('code', 'A backtick (`) cannot be typed inside code.');
  if (lineStart && !typed) {
    // Text deleted at a line start: what follows now starts the line
    const end = fileText.indexOf('\n', to);
    const at = blockStartAt(fileText.slice(to, end < 0 ? fileText.length : end));
    if (at >= 0) return { part: { from, to: to + at, text: fileText.slice(to, to + at) + '\\' } };
  }
  return { part: { from, to, text: typed } };
}

// Apply the changes made in the browser. `edits`: [{ s, e, before, after }] (s-e: an editable
// range of the built page, before: its text when the page was opened, after: its text now).
// `allowed`: Map "s-e" -> { s, e, kind, outer: { s, e } | null } read from the built page.
// All or nothing: { text, changed } or { error, message }.
export function applyEdits(fileText, edits, allowed, { mdx = false } = {}) {
  if (!Array.isArray(edits) || !edits.length) return fail('bad', 'No changes were sent.');
  if (edits.length > 5000) return fail('bad', 'Too many changes at once.');
  const parts = [];
  const seen = new Set();
  for (const edit of edits) {
    const { s, e, before, after } = edit ?? {};
    if (!Number.isInteger(s) || !Number.isInteger(e) || typeof before !== 'string' || typeof after !== 'string') {
      return fail('bad', 'A change could not be read.');
    }
    if (before.length > 200000 || after.length > 200000) return fail('bad', 'A change is too long.');
    const key = `${s}-${e}`;
    const range = allowed?.get(key);
    if (!range || seen.has(key) || range.e > fileText.length) return fail('bad', 'A change is for text that cannot be edited.');
    seen.add(key);
    const r = editPart(fileText, range, before, after, mdx);
    if (r.error) return r;
    if (r.part) parts.push(r.part);
  }
  parts.sort((a, b) => a.from - b.from || a.to - b.to);
  for (let k = 1; k < parts.length; k++) {
    if (parts[k].from < parts[k - 1].to) return fail('bad', 'Two changes overlap.');
  }
  let text = fileText;
  for (const part of [...parts].reverse()) text = text.slice(0, part.from) + part.text + text.slice(part.to);
  return { text, changed: parts.length };
}
