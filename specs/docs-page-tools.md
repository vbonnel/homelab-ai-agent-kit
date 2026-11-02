# Docs websites: copy-page menu, theme button, "On this page" style, picture pipeline

Status: planning
Size: normal
Database change: no
New settings (.env keys): none
Restart needed after merge: no (containers get it with `kit update`; each project then runs
`kit docs upgrade` through `/feature`)

## Goal
Four features built and used in one project's docs website become kit docs features, for new sites
(`kit docs init`) and existing ones (`kit docs upgrade`):
1. **Page actions** on the right of each page title: a split button. The main part copies the page
   as Markdown (for AI tools); the arrow opens a menu: copy the page, print the page, open in
   Claude, open in ChatGPT.
2. **"On this page" list** (right column): a thin grey line on its left, the section being read in
   bold with an accent bar on the line, hover darkens a section and shows a grey bar.
3. **Theme button**: Starlight's Dark / Light / Auto drop-down becomes one icon button (moon in
   light mode, sun in dark mode).
4. **Pictures**: every picture gets several widths (responsive `srcset`), and the originals stay
   light: `npm run images` resizes / recompresses them, and the build fails when one is too big.

## Not doing
- No change to Starlight, Astro or pele versions; no new npm package (sharp is already installed by
  `kit docs init`).
- No "View as Markdown" or Perplexity items, no MCP / editor items.
- No AVIF output. PDFs and other files are not pictures: unchanged.
- No browser tests (as before): pure functions are tested, the widgets are checked by the owner in
  a browser.
- Pages are never touched by the upgrade.

## Current situation
- `lib/docs-upgrade.mjs` adds Starlight component overrides listed in `KIT_COMPONENTS`
  (`SiteTitle`, `MarkdownContent`) to `astro.config.mjs` and copies their files (marker line
  `agent-kit: managed file`; a project file without it is kept). It also adds the kit's
  `diagrams()` integration (`KIT_DIAGRAMS`).
- `kit docs init` copies `templates/docs/`, runs `lib/docs-upgrade.mjs`, installs
  `astro @astrojs/starlight sharp pele`.
- `lib/docs-serve.mjs` has no MIME type for `.md`.

## Changes
New kit-managed files under `templates/docs/src/` (each with the marker line), generic: no project
names or addresses; labels in English, French when the page's language starts with `fr`.

### 1. Page actions
- `components/PageTitle.astro`: Starlight's `PageTitle`, then `PageActions` on its right (flex row,
  wraps under the title on narrow screens). Starlight shows `PageTitle` only on pages without a
  hero, so a splash homepage gets no menu. No menu on the 404 page.
- `components/PageActions.astro`: split button + menu (rounded, thin border, icon in a small box,
  title + grey hint, small "external" arrow on links that open a new tab), Starlight colours, light
  and dark:
  - Copy: fetches the page's `.md` once (first hover / focus of the widget) and copies it;
    `navigator.clipboard` on HTTPS, a hidden-textarea copy on plain HTTP (LAN sites). The main
    button holds its three labels ("Copy page" / "Copied!" / "Copy failed") and icons stacked in
    one grid cell, only the current one visible (`data-pa-state`), so its width never changes; a
    visually hidden `role="status"` tells screen readers. Back to "Copy page" after 2 s.
  - Print: before `window.print()`, every picture in the page loads now (lazy pictures, 10 s at
    most) and keeps the width it already has (srcset put aside until printing is done), so the
    print has no empty spaces. The widget itself is not printed.
  - Open in Claude / ChatGPT: links in a new tab (`https://claude.ai/new?q=`,
    `https://chatgpt.com/?q=`) with a short prompt in the page's language and the PUBLIC address
    of the page's `.md` file. **Only when the site has a public address** (`site:` in
    `astro.config.mjs`): those services can't read a LAN-only site, so LAN sites show copy and
    print only.
  - Menu: under the arrow, aligned right; Esc, outside click, Tab or a choice closes it; up / down
    / Home / End move between items; `aria-haspopup`, `aria-expanded`, `role=menu`.
- `pages/[...slug].md.ts`: at build time, one Markdown file per docs page next to it
  (`/getting-started.md`, base path respected): `# title`, `> description`, then the page's text
  without pictures (relative paths mean nothing outside the site) and comments. Text cleaning in
  `scripts/page-markdown.mjs` (`pageMarkdown({ title, description, body })`, plain JS, tested).
- `lib/docs-serve.mjs`: `.md` served as `text/markdown; charset=utf-8`.

### 2. "On this page" style
- `components/TableOfContents.astro`: Starlight's `TableOfContents` plus global styles for
  `starlight-toc` (desktop list; the narrow-screen drop-down is unchanged): rail
  `--sl-color-gray-5`, links `--sl-color-gray-3`; `a::before` 3px bar over the rail; hover /
  focus: text `--sl-color-white`, bar `--sl-color-gray-4`; current (`aria-current='true'`): text
  `--sl-color-white`, weight 600, bar `--sl-color-text-accent`.

### 3. Theme button
- `components/ThemeSelect.astro`: a `<button>` with Starlight's `moon` / `sun` icons (CSS shows
  the right one from `data-theme`), `aria-label` / `title` "Switch theme (light / dark)" (fr:
  "Changer de thème (clair / sombre)"). Click sets `data-theme` and stores it in `localStorage`
  `starlight-theme` (Starlight's key: its early script keeps applying it with no flash). Nothing
  stored: follows the system theme and its changes. Starlight shows it in the top bar and the
  phone menu.

### 4. Pictures
- `image-tools/rules.mjs` (shared, no sharp import, tested): limits (2000 px longest side,
  500 KB per raster picture, 200 KB per SVG), `walk`, the files that may use pictures (`src/**`
  `.md .mdx .astro .css .ts .mjs .js` and `astro.config.mjs`), `withoutComments`, and
  `findRefs(text, fromFile, picture)`: the references in a text that point to a picture (relative
  paths resolved from the using file, also `/src/...` paths), so renaming a picture rewrites only
  real references and "used" is exact.
- `image-tools/check.mjs` `checkPictures(docsDir)` -> `{ errors, warnings }` (uses sharp):
  - errors: a raster picture under `src/` longer than 2000 px or over 500 KB (fix: `npm run
    images`), an SVG over 200 KB;
  - warnings: two identical pictures, a picture used nowhere (comments don't count), a picture in
    `public/` (not optimised; `favicon.*` allowed).
- `image-tools/optimize.mjs` (`npm run images`): each raster picture under `src/`: too long ->
  resized to 2000 px (EXIF orientation applied); still over 500 KB -> WebP (quality 88, then
  lower / smaller if needed, transparency kept), old file removed, references updated; a PNG is
  re-compressed losslessly when that saves 5 %; JPEG / WebP that follow the rules are left alone.
  Prints what it did; safe to run again.
- `image-tools/images.mjs`: Astro integration `images()`:
  - sets `image: { layout: 'constrained', breakpoints: [400, 800, 1200, 1600, 2000] }` unless the
    project sets its own `image.layout` (every picture gets `srcset` + `sizes`, never wider than
    its original);
  - on `astro build`: runs `checkPictures`; errors stop the build with the fix to run, warnings
    are printed.
- `lib/docs-upgrade.mjs`: `useKitImages(text)` adds `import images from
  './src/image-tools/images.mjs';` and `images(), // pictures: ...` in `integrations` (after the
  diagrams line, else before `starlight(`), as text; kept as is when the config already has it.
  `package.json` gets `"images": "node src/image-tools/optimize.mjs"` unless it has an `images`
  script.

### Config and kit
- `KIT_COMPONENTS` gets `PageTitle` (files: PageTitle, PageActions, `pages/[...slug].md.ts`,
  `scripts/page-markdown.mjs`), `TableOfContents`, `ThemeSelect`. A component the project already
  sets to another file is kept (as today); a project file without the marker is kept.
- The config comment above `components:` lists the features; older kit comments are refreshed.
- `templates/docs/astro.config.mjs`: the 5 components, `images()`; `templates/docs/package.json`:
  `images` script.
- `bin/kit`: `kit docs upgrade` messages (`npm run images` if the build reports pictures).
- `README.md`: docs website section lists the new features and `npm run images`.

## Tests to add or update
`tests/test-docs-features.mjs` (temp folders only, no network, no npm install, no browser):
- `addComponents` adds the 3 new entries to a block / a new block; keeps a project's own
  `PageTitle` path; refreshes the older comments.
- `useKitImages`: adds the import and call (with and without the diagrams line), idempotent, keeps
  a config that already has it; `package.json` script added once, a project's own kept.
- `upgradeDocs` copies all new files (incl. `src/pages/[...slug].md.ts`), keeps unmarked ones.
- `pageMarkdown`: title / description / pictures and comments removed, blank lines squeezed.
- `findRefs` / `withoutComments`: relative refs, `/src/` refs, a same-named picture elsewhere is
  not a match, comment-only use is not a use.
- Every template file in `templates/docs/src/` has the marker; no project names / addresses.

## Acceptance checks
- [ ] Throwaway docs site upgraded with the work copy's kit: builds; every page except the
      splash homepage has the split button; `.md` files built; menu without AI items (no `site:`),
      with them when `site:` is set
- [ ] Copy works on plain HTTP (LAN preview); print prints the page without the widget
- [ ] "On this page" rail / bar / bold; theme button toggles and is remembered
- [ ] Built pictures have `srcset`; a 3 MB photo stops the build with `npm run images`, which
      fixes it
- [ ] Upgrading a site whose project already has its own PageTitle / PageActions keeps them
- [ ] `scripts/test.sh` passes

## Implementation notes
- Public repo: no IPs, host names, container or project names in any file or commit.
- Keep `upgradeDocs` writing nothing when the config has a problem.
