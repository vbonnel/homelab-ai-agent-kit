# Docs websites: copy / save a diagram as SVG, and export the whole docs as one Markdown file

Status: tests passed
Size: normal
Database change: no
New settings (.env keys): none
Restart needed after merge: no (containers get it with `kit update`; each project then runs
`kit docs upgrade` through `/feature`)

## Goal
Two owner requests for every kit docs website:
1. **Diagram as SVG**: in the full-screen viewer, a diagram gets two buttons, **Copy SVG** and
   **Save SVG**, to paste it into Figma / Penpot (pasted as editable shapes) or import the file.
   The SVG is self-contained: real colours, fonts and corner radii written into it (today pele
   writes `fill="var(--_s)"`-style references to the site's CSS, which design tools can't read).
2. **Export**: an **Export** button on the right of the top bar downloads the whole documentation
   as one Markdown file (every page of the sidebar, in sidebar order), to upload into an AI tool's
   project as context.

## Not doing
- No PNG export, no export of pictures (photos / screenshots): the two buttons show for diagrams
  only.
- The SVG has the colours of the theme being shown (light or dark), with the diagram's background
  as a rectangle behind it: switch the theme first to get the other one.
- Sites still drawing with astro-mermaid (mermaid.js): the buttons work, but mermaid.js puts its
  labels in HTML boxes (`foreignObject`) that Figma / Penpot may drop. Kit sites drawn by pele are
  plain SVG text.
- Export: pages not in the sidebar, and links to other websites, are not included. No file built on
  the server (the browser assembles the per-page `.md` files that already exist). No "copy all"
  variant.
- No new npm package, no change to Starlight, Astro or pele versions. Pages are never touched.
- No browser in this container: pure functions are tested here; clicking, pasting into Figma /
  Penpot and the download are checked by the owner in a browser.

## Current situation
- `templates/docs/src/scripts/diagram-zoom.mjs`: the viewer (`<dialog>`), its bar has − + Fit ✕.
  A diagram is copied into it from the page's `<svg>` (pele output inside `div.kit-diagram`).
- pele's SVG uses CSS variables in attributes and styles (`fill="var(--_s)"`, `style="rx:var(--_r)"`,
  root `style="--_bg:var(--pele-bg,#fff);..."`), resolved by `src/diagrams/theme.css` on the page.
- Every docs page already has a Markdown version (`src/pages/[...slug].md.ts`): `/getting-started.md`,
  root page `/index.md`.
- Starlight's top bar (desktop) shows SocialIcons | ThemeSelect | LanguageSelect on the right; the
  phone menu shows the same three at its bottom. The kit already replaces ThemeSelect.
- `lib/docs-upgrade.mjs` adds the kit's components (`KIT_COMPONENTS`) to `astro.config.mjs` and
  copies their files.

## Changes

### 1. Diagram as SVG
- New `templates/docs/src/scripts/diagram-export.mjs` (kit-managed, plain JS, pure parts tested):
  - `PAINT`: the properties written into the SVG: fill, fill-opacity, fill-rule, stroke,
    stroke-width, stroke-opacity, stroke-dasharray, stroke-dashoffset, stroke-linecap,
    stroke-linejoin, stroke-miterlimit, font-family, font-size, font-weight, font-style,
    text-anchor, dominant-baseline (inherited), opacity, rx, ry (not inherited).
  - `toHex(colour)` -> `{ value, alpha }`: `rgb()` / `rgba()` become `#rrggbb` (+ alpha); `none`,
    `url(...)` and other values unchanged.
  - `exportAttributes(tag, own, parent)` -> `[[name, value], ...]` from the element's computed
    values and its parent's: an inherited property is written only when it differs from the parent
    (the root: from the SVG default); opacity only when not 1; rx / ry only on `rect` / `ellipse`,
    without `px`; a colour with alpha also gets `fill-opacity` / `stroke-opacity` (multiplied);
    `font-size` without `px`.
  - `svgFileName(title, n)` -> `getting-started-diagram-2.svg` (letters / digits / dashes, accents
    removed; empty title -> `diagram-2.svg`).
  - `selfContainedSvg(svg)` (browser): copies the page's `<svg>`, walks the copy and the original
    together, removes the copy's `style` attributes, its `<style>` elements and the PAINT
    attributes, then writes `exportAttributes` from `getComputedStyle` of the original; sets
    `width` / `height` from the viewBox; puts a `<rect>` in the diagram's background colour (the
    `.kit-diagram` card, else `--pele-bg`) first; returns the SVG text (`XMLSerializer`). Ids are
    kept (arrow heads point to them).
- `templates/docs/src/scripts/diagram-zoom.mjs`: two bar buttons before Fit, **Copy SVG** and
  **Save SVG** (shown for diagrams, hidden for pictures), the SVG made from the diagram on the page
  when clicked:
  - Copy: `navigator.clipboard.writeText` on HTTPS; on plain HTTP a hidden textarea placed
    **inside the dialog** (outside it the page is inert while the viewer is open); the button shows
    "Copied!" or "Copy failed" for 2 s (fixed width), a `role="status"` line tells screen readers.
  - Save: downloads `svgFileName(<page title>, <diagram number on the page>)` (Blob link, works on
    HTTP).
  - A click on these buttons never closes the viewer. Hint text unchanged.
- `templates/docs/src/components/MarkdownContent.astro`: comment (copy / save SVG); a style so the
  copy button keeps its width.

### 2. Export the whole docs
- New `templates/docs/src/components/SocialIcons.astro` (kit-managed): Starlight's own SocialIcons
  (a project's `social:` links keep showing), then the **Export** button (download icon + "Export";
  French: "Exporter"; hover text "Download the whole documentation as one Markdown file (for AI
  tools)" / "Télécharger toute la documentation en un seul fichier Markdown (pour les IA)"). In the
  top bar it sits left of the light / dark button, with Starlight's separator between them; on
  phones it is in the menu, with the theme button. Not printed.
  - At build time it lists the sidebar's pages from `Astro.locals.starlightRoute.sidebar` with
    `exportList(sidebar)` and puts them in a `data-` attribute.
  - On click: fetches every page's `.md` (all at once), skips one that fails, makes the file with
    `exportMarkdown`, downloads it as `exportFileName(<site title>)`. The button says
    "Exporting..." meanwhile, "Export failed" for 2 s when no page could be read.
- New `templates/docs/src/scripts/export-docs.mjs` (kit-managed, plain JS, tested):
  - `exportList(sidebar)` -> `[{ label, href, md }]`: links in sidebar order, groups flattened
    (label "Group / Page"), links to other websites and `#` parts dropped, a page listed twice kept
    once; `md`: `/getting-started/` -> `/getting-started.md`, the site root (`/` or the base path)
    -> `<base>/index.md`, base path kept.
  - `exportMarkdown({ title, address, date, pages })` -> the file: `# <title>: documentation`, a
    short note (how many pages, from which address, which date, each page starts with its own `#`
    title, pages separated by `---`), a numbered list of the pages, then each page's Markdown.
  - `exportFileName(title)` -> `my-project-docs.md` (empty -> `docs.md`).
- `lib/docs-upgrade.mjs`: `KIT_COMPONENTS` gets `SocialIcons` (files: `SocialIcons.astro`,
  `export-docs.mjs`) on top; `MarkdownContent` also gets `diagram-export.mjs`. The config comment
  above `components:` mentions the Export button and diagram copy; today's comment goes into
  `OLD_COMMENTS` so it is brought up to date once.
- `templates/docs/astro.config.mjs`: `SocialIcons` entry and the new comment (exactly what an
  upgraded config gets).
- `README.md`: docs website paragraph (Copy SVG / Save SVG in the viewer; Export button) and the
  upgrade feature list.

## Tests to add or update
`tests/test-docs-features.mjs` (temp folders only, no network, no npm install, no browser):
- `toHex`: rgb, rgba with alpha, `none`, `url(#x)` kept.
- `exportAttributes`: inherited value written only when different from the parent; root compared
  to SVG defaults; opacity 1 skipped; rx on a rect without `px`, not on a path; rgba fill gives
  `fill-opacity`.
- `svgFileName`: accents and spaces, empty title.
- `exportList`: groups in order with "Group / Page" labels, external link and duplicate dropped,
  `#` part dropped, root -> `/index.md`, base path `/docs/` kept.
- `exportMarkdown`: title, page count and address in the note, numbered list, pages in order
  separated by `---`.
- `exportFileName`: spaces / accents, empty.
- Template checks: the viewer has Copy SVG / Save SVG, hidden for pictures, the textarea fallback
  inside the dialog; SocialIcons renders Starlight's default and the export button; config has
  `SocialIcons`; every kit file has the marker (existing test, new files included through
  `KIT_COMPONENTS`).
- Config upgrade tests: the added lists now start with `SocialIcons`; older configs (and the last
  template) still become exactly the new template, once; the previous comment is updated once.

## Acceptance checks
- [ ] Throwaway docs site (made by this work copy's `kit docs init` in a temp folder) builds; the
      Export button is in the built pages with the sidebar's page list; the viewer script has the
      two buttons
- [ ] The SVG made from a real pele diagram has no `var(` left and real colours (checked by running
      the export on the built site's diagram in Node with the computed colours of the theme file,
      as far as possible without a browser)
- [ ] Owner, in a browser: Copy SVG then paste into Figma / Penpot gives the diagram with its
      colours; Save SVG downloads a file that opens / imports; Export downloads one `.md` with all
      pages
- [ ] `scripts/test.sh` passes

## Implementation notes
- Style: short plain comments like the rest of the kit; LF line endings; generic files (no project
  names, addresses or host names: public repo).
- `diagram-zoom.mjs` keeps its name; the new script is imported by it, so `MarkdownContent` lists it
  in its files.
- The export reads `Astro.locals.starlightRoute.sidebar` (Starlight 0.32+; the kit's sites use it
  already for `starlightRoute`).
