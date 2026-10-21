# Docs websites: diagrams drawn by pele, in Atlassian colours

Status: planning
Size: normal
Database change: no
New settings (.env keys): none
Restart needed after merge: no (containers get it with `kit update`; each existing project then
runs `kit docs upgrade` through `/feature`, like the last docs feature)

## Goal
The docs websites draw their Mermaid diagrams with **pele** (https://pele.run, npm `pele`, MIT, no
dependencies, made by Obsidian) instead of mermaid.js:
- Drawn once, **when the website is built**: pages show finished pictures at once, no diagram code
  is sent to the browser (today about 3.6 MB of mermaid.js), and the website builds faster.
- **Colours from the Atlassian Design System** (the palette of Confluence and Jira, current 2025
  values from Atlassian's own `@atlaskit/tokens`), light and dark, following the site's theme
  switch instantly (no redraw).
- **Kinds of boxes** for architecture diagrams, one class each: `service` (default look), `ui`,
  `data`, `queue`, `external`, `person`, `new`, `risk`. C4 diagrams get the same colours by
  themselves (people, systems, containers, databases, queues, external systems).
- **A broken diagram stops `kit docs build`** with the page, the line in the file and what is wrong.
  So `kit merge` (which builds the docs) never puts a broken diagram online, and builder agents see
  their diagram mistakes. Today a broken diagram only shows as an error picture in the browser.
- The "Enlarge" full-screen viewer keeps working.

## Not doing
- No change to the Astro / Starlight versions installed by `kit docs init`. Found while planning
  (separate fix, to propose after this one): Astro 7.4.2, out today, needs Node.js 22.23.4+ and this
  container has 22.23.3, so `kit docs init` currently fails its first build here.
- No icons (`fa:fa-...`) or maths (`$$...$$`) inside labels: pele needs extra add-ons for them;
  they show as plain text. Mermaid's own themes (`%%{init: {theme...}}%%`, `themeVariables`) no
  longer apply: colours come from the CSS theme. `classDef` and `style` still work.
- No drawing in the browser (pele's `mount()`); no change to the zoom sums or the version pill.
- No automatic browser tests: the before/after demo is checked by hand (screenshots).

## Current situation
- `templates/docs/astro.config.mjs` uses the `astro-mermaid` integration: each ```mermaid block
  becomes `<pre class="mermaid">` and mermaid.js draws it in the browser (and again on each
  light/dark switch). `kit docs init` installs `astro-mermaid` and `mermaid@^11`.
- The viewer (`src/scripts/diagram-zoom.mjs`, `src/components/MarkdownContent.astro`) looks for
  `pre.mermaid[data-processed] > svg`.
- `lib/docs-upgrade.mjs` adds/updates the kit's managed files (marker line
  `agent-kit: managed file`) and the `components` entries of `astro.config.mjs`.
- Astro 7 (June 2026) uses a new Markdown engine, Sätteri: plugins are `mdastPlugins` of
  `@astrojs/markdown-satteri`; old remark plugins only run with an extra package. Its positions
  count from after the frontmatter, and its text is trimmed.

## Changes
- New kit-managed files in `templates/docs/src/diagrams/` (marker line, copied to `<docs>/src/`):
  - `draw.mjs` (no imports, tested): `drawCode(node, count, page, draw, skipped)` -> the HTML for one
    ```mermaid block: `<div class="kit-diagram" data-diagram="<type>"><svg ...></div>`, ids
    `kit-diagram-<n>-` unique on the page; `drawDiagrams(tree, page, draw, skipped)` for a whole
    mdast tree (older Astro); `isDiagram(node)`; `diagramError(error, node, page, skipped)` ->
    `Diagram error in src/content/docs/x.md, line 12 (line 3 of the diagram): <pele's message>`;
    `linesBefore(fileText, body)` -> lines skipped before the text Markdown got.
  - `diagrams.mjs`: the Astro integration `diagrams()`. Astro 7 (Sätteri): adds an mdast plugin
    made per page (`{ position: true }`, `code` visitor returns an `html` node). Older Astro: a
    remark plugin. pele options: font list Helvetica/Arial/Liberation Sans/Arimo (the widths pele
    measures with at build time, so labels fit their boxes), font size 14. Adds `theme.css` to
    every page.
  - `theme.css`: `--pele-*` variables, dark in `:root` (Starlight's default) and light in
    `:root[data-theme='light']`, from Atlassian tokens (text `#292A2E`/`#CECFD2`, brand
    `#1868DB`/`#669DF1`, accent fills and borders, chart colours for pie/git graphs); the card
    around each diagram; the kinds of boxes (fill + edge colour, `external` dashed, `person`
    solid with light text); C4 element colours; a comment listing the kinds of boxes.
- `templates/docs/astro.config.mjs`: `import diagrams from './src/diagrams/diagrams.mjs'` and
  `diagrams(),` instead of the astro-mermaid lines; header comment updated (diagrams drawn at
  build time, kinds of boxes in src/diagrams/theme.css).
- `templates/docs/src/scripts/diagram-zoom.mjs` and `src/components/MarkdownContent.astro`: the
  viewer handles `div.kit-diagram` (drawn at build) and still `pre.mermaid` (sites not switched);
  the viewer's background uses `--pele-bg` when set.
- `templates/docs/pages/how-it-works.md`: a short hidden hint (HTML comment) for the agents filling
  it: draw with ```mermaid, and the kinds of boxes.
- `lib/docs-upgrade.mjs`:
  - `KIT_DIAGRAMS` = the three files above.
  - `useKitDiagrams(text)` -> `{ text, switched, problem }`: replaces the kit's astro-mermaid
    import line and its `mermaid({...}),` line by the kit diagrams lines (same indentation). Already
    switched: nothing to do. A config whose astro-mermaid lines are not the kit's (or not found):
    unchanged, reported as kept with what to change by hand; the other features are still added.
  - `upgradeDocs`: also runs `useKitDiagrams`; copies/updates the diagram files when the config uses
    them; reports the switch.
- `bin/kit`:
  - `kit docs init`: installs `pele@^1.8.0` instead of `astro-mermaid` and `mermaid@^11`.
  - `kit docs upgrade`: when the config uses the kit diagrams and `package.json` has no `pele`:
    installs `pele@^1.8.0` and removes `astro-mermaid` and `mermaid` in the docs folder. In a work
    copy whose `node_modules` is a link to the real project's packages, the link is replaced by the
    work copy's own install first (the real project's packages never change from a work copy).
- `claude/skills/feature/SKILL.md` (Step 4) and `claude/skills/init-project/SKILL.md` (Step 6):
  one line each on diagrams (kinds of boxes; a diagram error stops `kit docs build`).
- `README.md`: docs website paragraph (pele, Atlassian colours, kinds of boxes, broken diagrams
  stop the build), upgrade section, file list.

## Tests to add or update
`tests/test-docs-features.mjs` (still temp folders only: no network, no npm install, no browser;
pele is replaced by a fake `draw` function):
- `drawCode`: the SVG ends up in `div.kit-diagram` with the type; ids numbered per page; an error
  with a line gives the line in the file (with frontmatter skipped), one without a line gives the
  diagram's first line; the page name is in the message.
- `drawDiagrams`: a tree with two ```mermaid blocks (one inside a list) and a ```js block: both
  diagrams replaced by `html` nodes, the js block untouched, count 2.
- `linesBefore`: frontmatter and blank lines counted; trimmed body found; missing body gives 0.
- `useKitDiagrams`: the old template config and the previous one (with components) become exactly
  the new template config together with `addComponents`; a second run changes nothing; a config with
  a different astro-mermaid call is unchanged and reported.
- `upgradeDocs` on the previous template's docs folder: switched, the diagram files added, pages
  untouched; a project with its own `mermaid({...})` options keeps astro-mermaid and still gets the
  other files.
- Template: `astro.config.mjs` uses `diagrams()` and no astro-mermaid; the diagram files have the
  marker; `theme.css` sets every kind of box in both themes; the viewer looks for `.kit-diagram`.
- `kit docs upgrade` (real command, throwaway git repo): a stand-in `npm` placed first on PATH
  records its calls, so nothing is downloaded. Real project: `npm install ... pele@^1.8.0` then
  `npm uninstall ... astro-mermaid mermaid`, config switched. Work copy whose `docs/node_modules`
  links to the real project's: the link is removed before npm runs, the real project's folder is
  untouched. The existing upgrade test uses the stand-in too (it would download otherwise).

## Acceptance checks
- [ ] A docs website built from the new template draws every diagram of the demo page (flowchart,
      sequence, C4, architecture, state, ER, class) at build time; no mermaid.js in `dist/`
- [ ] Light/dark switch recolours diagrams with no redraw; kinds of boxes and C4 colours show
- [ ] A broken diagram stops the build; the message gives the page and the right line in the file
- [ ] `.mdx` pages work (braces in labels, components next to diagrams)
- [ ] "Enlarge" viewer works on the new diagrams
- [ ] `kit docs upgrade` switches a site made with the previous template, then it builds
- [ ] Before/after demo: two sites served in the container and a page with screenshots
- [ ] `scripts/test.sh` passes

## Implementation notes
- The prototype in the scratch folder proved: Sätteri plugin, MDX, error lines, theme switch CSS.
- Style: short plain comments like the rest of the kit; LF line endings.
- After the merge: push to GitHub (owner), then in each container `kit update`, and in each project
  with a docs website `/feature` with `kit docs upgrade`, `kit docs build`, merge.
