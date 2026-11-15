// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// The whole documentation in one Markdown file, for the "Export" button of the top bar
// (components/SocialIcons.astro): to upload into an AI tool's project as context. The pages are
// those of the sidebar, in its order; each one is its Markdown version, made at build time by
// src/pages/[...slug].md.ts (the page's text without pictures and comments). The browser fetches
// them and puts them together: nothing more is built. Kept apart so the agent kit's tests can
// check it without Astro.

const OUTSIDE = /^([a-z][a-z\d+.-]*:|\/\/)/i; // https://..., mailto:..., //host...

// exportList(sidebar, base) -> [{ label, href, md }]: the pages of Starlight's sidebar
// (Astro.locals.starlightRoute.sidebar), in its order. Groups are flattened (label "Group / Page"),
// links to other websites and #parts are left out, a page listed twice is kept once.
// md: /getting-started/ -> /getting-started.md; the site's root -> <base>/index.md.
export function exportList(sidebar, base = '/') {
  const root = String(base).replace(/\/+$/, '');
  const out = [];
  const seen = new Set();
  const walk = (entries, groups) => {
    for (const e of entries ?? []) {
      if (e?.type === 'group') walk(e.entries, [...groups, e.label]);
      if (e?.type !== 'link' || typeof e.href !== 'string' || OUTSIDE.test(e.href)) continue;
      const path = e.href.split(/[?#]/)[0].replace(/(\/index)?\.html$/, '').replace(/\/+$/, '');
      if (!path.startsWith('/') && path !== '') continue;
      const md = path === root ? `${root}/index.md` : `${path}.md`;
      if (seen.has(md)) continue;
      seen.add(md);
      out.push({ label: [...groups, e.label].join(' / '), href: e.href.split('#')[0], md });
    }
  };
  walk(sidebar, []);
  return out;
}

const TEXT = {
  en: {
    head: (t) => `# ${t}: documentation`,
    note: (n, from, date) => `> The whole documentation website in one file: ${n} page${n === 1 ? '' : 's'}`
      + `${from ? `, from ${from}` : ''}, exported on ${date}.\n`
      + '> Each page starts with its own "# " title; pages are separated by a line with "---".',
    pages: 'Pages',
  },
  fr: {
    head: (t) => `# ${t} : documentation`,
    note: (n, from, date) => `> Tout le site de documentation en un seul fichier : ${n} page${n === 1 ? '' : 's'}`
      + `${from ? `, depuis ${from}` : ''}, exporté le ${date}.\n`
      + '> Chaque page commence par son propre titre « # » ; les pages sont séparées par une ligne « --- ».',
    pages: 'Pages',
  },
};

// exportMarkdown({ title, address, date, lang, pages: [{ label, href, text }] }) -> the file:
// a title, a short note, the numbered list of the pages (with their address), then every page.
export function exportMarkdown({ title, address = '', date, lang = 'en', pages }) {
  const t = /^fr\b/i.test(lang) ? TEXT.fr : TEXT.en;
  const origin = String(address).replace(/\/+$/, '');
  const from = origin ? `${origin}/` : '';
  const list = pages.map((p, i) => `${i + 1}. ${p.label}${origin && p.href ? `: ${new URL(p.href, `${origin}/`).href}` : ''}`);
  const parts = [
    `${t.head(title || 'Docs')}\n\n${t.note(pages.length, from, date)}\n\n## ${t.pages}\n\n${list.join('\n')}`,
    ...pages.map((p) => String(p.text ?? '').trim()),
  ];
  return `${parts.join('\n\n---\n\n')}\n`;
}

// exportFileName('My project') -> 'my-project-docs.md'
export function exportFileName(title) {
  const name = String(title ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');
  return `${name ? `${name}-` : ''}docs.md`;
}

// Today in the reader's time zone: 2026-11-14
export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
