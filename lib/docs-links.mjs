// Links of a built docs website, for saving a page changed in the browser (docs-edit.mjs). A
// heading's #anchor comes from its text: when a save renames a heading, the links to its section
// from the site's pages are found here and rewritten in their Markdown, and the website is checked
// for links that the save would break. No packages.
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const decodeHtml = (text) => String(text ?? '').replace(/&(#\d{1,7}|#x[0-9a-f]{1,6}|amp|lt|gt|quot|apos);/gi, (m, name) => {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[name.toLowerCase()];
  if (named) return named;
  const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
});

// A page's address as the site serves it: "/a/b/index.html", "/a/b" and "/a/b/" -> "/a/b/".
// A file with an extension (/a.md, /x.pdf) keeps its name.
export function pageUrl(path) {
  let p = String(path || '/').replace(/\/index\.html$/, '/').replace(/\.html$/, '/');
  if (!p.startsWith('/')) p = `/${p}`;
  if (!p.endsWith('/') && !/\.[a-z0-9]+$/i.test(p.slice(p.lastIndexOf('/') + 1))) p += '/';
  return p;
}

// A link as written in a page at `fromUrl` -> { href, path, fragment }, or null for a link that
// leaves the site (http:, mailto:, //host...)
export function resolveLink(href, fromUrl) {
  const h = String(href ?? '').trim();
  if (!h || /^[a-z][a-z0-9+.-]*:/i.test(h) || h.startsWith('//')) return null;
  let url;
  try {
    url = new URL(h, `http://site${pageUrl(fromUrl)}`);
  } catch {
    return null;
  }
  const decode = (s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  return { href: h, path: pageUrl(decode(url.pathname)), fragment: decode(url.hash.slice(1)) };
}

// The ids of a built page's headings, in order
export function headingIds(html) {
  return [...String(html ?? '').matchAll(/<h[1-6]\b[^>]*?\sid="([^"]*)"/g)].map((m) => decodeHtml(m[1]));
}

// The headings whose id changed (same headings in the same order: a text edit never adds or
// removes one) -> Map old id -> new id; empty when the pages don't match
export function renamedSections(oldIds, newIds) {
  const renamed = new Map();
  if (!oldIds || !newIds || oldIds.length !== newIds.length) return renamed;
  oldIds.forEach((id, i) => {
    if (id !== newIds[i]) renamed.set(id, newIds[i]);
  });
  return renamed;
}

const linksIn = (html, fromUrl) => {
  const links = [];
  for (const m of html.matchAll(/<a\b([^>]*)>/g)) {
    if (/\sclass="[^"]*\bsl-anchor-link\b/.test(m[1])) continue; // the # next to a heading
    const href = /\shref="([^"]*)"/.exec(m[1])?.[1];
    const link = href === undefined ? null : resolveLink(decodeHtml(href), fromUrl);
    if (link) links.push(link);
  }
  return links;
};

// The links of a page's text: between Starlight's content block and its page footer
export function contentLinks(html, fromUrl) {
  const text = String(html ?? '');
  const start = text.indexOf('class="sl-markdown-content"');
  if (start < 0) return [];
  const main = text.indexOf('</main>', start);
  const footer = text.lastIndexOf('<footer', main < 0 ? text.length : main);
  const end = footer > start ? footer : main > start ? main : text.length;
  return linksIn(text.slice(start, end), fromUrl);
}

// Every link of a page a reader can follow, except the "On this page" lists (made from the
// headings themselves) and the # next to headings: the page text, the sidebar, the footer...
export function pageLinks(html, fromUrl) {
  const text = String(html ?? '').replace(/<(mobile-starlight-toc|starlight-toc)\b[\s\S]*?<\/\1>/g, '');
  return linksIn(text, fromUrl);
}

// The page's Markdown file, as the website build wrote it (components/PageEdit.astro)
export function sourceOf(html) {
  const tag = /<kit-page-edit\b[^>]*>/.exec(String(html ?? ''))?.[0];
  const file = tag && /\sdata-file="([^"]*)"/.exec(tag)?.[1];
  return file ? decodeHtml(file) : '';
}

async function htmlFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await htmlFiles(path)));
    else if (entry.isFile() && entry.name.endsWith('.html')) out.push(path);
  }
  return out;
}

// The built website: Map page address -> { headings, ids, links (page text), all (every link
// but the "On this page" lists), source (its Markdown file, from the docs folder) }
export async function siteLinks(dist) {
  const site = new Map();
  for (const file of await htmlFiles(dist)) {
    const url = pageUrl(file.slice(dist.length).split('\\').join('/'));
    const html = await readFile(file, 'utf8');
    site.set(url, {
      headings: headingIds(html),
      ids: new Set([...html.matchAll(/\sid="([^"]*)"/g)].map((m) => decodeHtml(m[1]))),
      links: contentLinks(html, url),
      all: pageLinks(html, url),
      source: sourceOf(html),
    });
  }
  return site;
}

// Links to a page or a section that doesn't exist: Set of "from page|link". Links to files
// (/x.md, /picture.png) and to the top of a page are not checked.
export function brokenLinks(site) {
  const broken = new Set();
  for (const [from, page] of site) {
    for (const link of page.all) {
      if (!link.path.endsWith('/')) continue;
      const target = site.get(link.path);
      if (!target || (link.fragment && link.fragment !== '_top' && !target.ids.has(link.fragment))) broken.add(`${from}|${link.href}`);
    }
  }
  return broken;
}

// In a page's Markdown (the page at `fromUrl`), the link destinations that lead to `targetUrl`
// with a renamed section get the new #anchor: ](…), [ref]: …, href="…". All renames at once (a
// section can take the old name of another). Fenced code blocks are left as they are.
const DESTINATION = /(\]\(\s*<?|^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?|\bhref\s*=\s*["'{]?\s*["']?)([^\s()"'<>{}]*#[^\s()"'<>{}]*)/g;
export function rewriteSectionLinks(text, fromUrl, targetUrl, renamed) {
  let count = 0;
  let fence = '';
  const lines = String(text ?? '').split('\n').map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || marker[0] === fence[0])) {
      fence = fence ? '' : marker;
      return line;
    }
    if (fence) return line;
    return line.replace(DESTINATION, (all, lead, dest) => {
      const link = resolveLink(dest, fromUrl);
      if (!link || link.path !== pageUrl(targetUrl) || !renamed.has(link.fragment)) return all;
      count++;
      return `${lead}${dest.slice(0, dest.indexOf('#') + 1)}${renamed.get(link.fragment)}`;
    });
  });
  return { text: lines.join('\n'), count };
}
