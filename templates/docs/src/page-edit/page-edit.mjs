// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Page text that can be changed in the browser (the Edit button next to the page title,
// components/PageEdit.astro). When the website is built, each piece of text of a page that its
// Markdown file holds as plain text is put in <span data-kit-src="S-E">: S-E is where it is in
// the file. data-kit-kind adds: c inline code, t table cell, h heading, e the only text of a bold /
// italic / struck part. data-kit-outer="S-E": the part to remove when that text is emptied.
// Code blocks, diagrams, pictures, raw HTML and text made by components get nothing.
// The page looks the same: the spans have no style unless editing.
// Set in astro.config.mjs: `pageEdit()` in `integrations`. Astro 7 (Sätteri) only; an older
// Astro gets no editable text, so no Edit button.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { alignText, bodyOffset, codeRange } from './markdown-text.mjs';

const SKIP = new Set(['pre', 'script', 'style', 'svg', 'textarea', 'template', 'math', 'button']);
const WRAPPERS = new Set(['strong', 'em', 'del', 's', 'a', 'code']);
const EMPHASIS = new Set(['strong', 'em', 'del', 's']);
const isElement = (node, tags) => node?.type === 'element' && tags.has(node.tagName);

// One text node -> the span's properties, or null when it can't be edited. `ctx`: Sätteri's hast
// visitor context (parent()); `text`: the page's file; `base`: where the page source starts in it.
export function editableProps(node, ctx, text, base) {
  const start = node?.position?.start?.offset;
  const end = node?.position?.end?.offset;
  if (!Number.isInteger(start) || !Number.isInteger(end) || end <= start || !node.value?.trim()) return null;
  const chain = [];
  for (let p = ctx.parent(node); p && p.type !== 'root'; p = ctx.parent(p)) chain.push(p);
  if (chain.some((p) => isElement(p, SKIP) || p.type === 'raw')) return null;
  const s = base + start, e = base + end;
  const source = text.slice(s, e);
  let range = [s, e];
  let kind = '';
  if (isElement(chain[0], new Set(['code']))) {
    const inside = codeRange(source, node.value);
    if (!inside) return null;
    range = [s + inside[0], s + inside[1]];
    kind += 'c';
  } else if (!alignText(source, node.value)) {
    return null;
  }
  const only = (p) => (p.children?.length ?? 0) === 1;
  if (chain.some((p) => isElement(p, new Set(['td', 'th'])))) kind += 't';
  if (chain.some((p) => p.type === 'element' && /^h[1-6]$/.test(p.tagName))) kind += 'h';
  if (isElement(chain[0], EMPHASIS) && only(chain[0])) kind += 'e';
  // Emptied, the text takes away the outermost of the bold / link / code parts holding only it
  let outer = null;
  for (const p of chain) {
    if (!isElement(p, WRAPPERS) || !only(p) || !Number.isInteger(p.position?.start?.offset)) break;
    outer = [base + p.position.start.offset, base + p.position.end.offset];
  }
  const props = { dataKitSrc: `${range[0]}-${range[1]}` };
  if (kind) props.dataKitKind = kind;
  if (outer && outer[0] <= range[0] && outer[1] >= range[1]) props.dataKitOuter = `${outer[0]}-${outer[1]}`;
  return props;
}

// Sätteri plugin for one page (made for each page, with its file and source), or null
export function pageEditPlugin(page) {
  const file = page?.fileURL && fileURLToPath(page.fileURL);
  if (!file || !/\.mdx?$/i.test(file)) return null;
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  const base = bodyOffset(text, page.source);
  if (base < 0) return null;
  return {
    name: 'kit-page-edit',
    options: { position: true },
    text(node, ctx) {
      const properties = editableProps(node, ctx, text, base);
      if (properties) ctx.wrapNode(node, { type: 'element', tagName: 'span', properties, children: [] });
    },
  };
}

export default function pageEdit() {
  return {
    name: 'kit-page-edit',
    hooks: {
      'astro:config:setup': ({ config }) => {
        // Sätteri's options are made to be added to by integrations (.md and .mdx pages)
        const plugins = config.markdown?.processor?.name === 'satteri' && config.markdown.processor.options?.hastPlugins;
        if (Array.isArray(plugins)) plugins.push(pageEditPlugin);
      },
    },
  };
}
