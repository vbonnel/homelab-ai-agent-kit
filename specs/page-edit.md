# Docs websites: change a page's text in the browser (Edit / Save / Discard)

Status: planning
Size: normal
Database change: no
New settings (.env keys): none. New project setting in `.agentkit`: `DOCS_EDIT=on` (off when
missing), optional `DOCS_EDIT_HOSTS=<names>`; set with the new `kit docs edit on|off`.
Restart needed after merge: the docs website service, once, to load the new server code
(`kit docs edit on` restarts it). Sites get the browser part with `kit docs upgrade` (`/feature`).

## Goal
The owner wants to fix the text of a docs page by typing in the page itself, like the "Edit
Anything" browser extension, but saved for real. An **Edit** button next to the page title turns
the page's text into editable text; a bar at the bottom has **Discard** and **Save**. Save writes
the change into the page's `.md` / `.mdx` file (only the changed words: the rest of the file stays
byte for byte), rebuilds the website and saves the file in git as its own version, so it can be
undone like any other change.

## Not doing
- Text only: no new paragraphs or lines (Enter does nothing), no bold / links / lists / pictures
  added or removed, no link addresses. Code blocks, diagrams, pictures, raw HTML and text that
  the Markdown does not hold as plain text (made by a component) stay as they are.
- Typed characters are always text: `*`, `_`, `[`, `<`, `#`... are written so they show as typed
  (a backslash before them in the file when needed), never as Markdown formatting.
- Only Astro 7 sites (the Sätteri Markdown processor). An older Astro site gets no Edit button
  (nothing changes for it).
- No password or accounts: when editing is on, anyone who can open the website can change it.
  It is off unless the project turns it on (`kit docs edit on`); the protections below stop other
  websites from doing it through the owner's browser.
- No live preview of Markdown, no history screen in the page (git keeps the versions).
- Sites are not upgraded by this feature (the owner rolls the kit out by hand).

## Current situation
- `lib/docs-serve.mjs`: a small static server for `dist/` (GET/HEAD only).
- Pages are Markdown in `docs/src/content/docs/`, turned into HTML by Sätteri (Astro 7). A
  prototype showed that Sätteri's HTML-tree plugins (`hastPlugins`, `options.position`) give each
  text piece its place in the page source (offsets in the text after the frontmatter; for `.mdx`
  the frontmatter is blanked, so offsets are file offsets), and that wrapping each piece in a
  `<span>` keeps headings' ids, the "On this page" list and the page style unchanged.
- Smart quotes, dashes and `...` are applied (`'` -> `’`, `--` -> `–`), entities and backslash
  escapes are decoded, blockquote and list lines lose their `>` / indentation: the shown text is
  not always the file text, so the two are lined up character by character.

## Changes
### Build: where each piece of text comes from
- New `templates/docs/src/page-edit/markdown-text.mjs` (pure, no packages; also used by the
  server through the kit's own copy):
  - `alignText(source, shown)` -> `map` (for each position in the shown text, the position in
    the source) or `null`. Same character; `’ ‘` <- `'`; `“ ”` <- `"`; `—` <- `---`; `–` <- `--`;
    `…` <- `...`; a backslash escape; an HTML entity (named: a fixed list; numeric); a line break
    with the source's trailing spaces before it and its `>` / spaces after it; leading spaces of
    the source; trailing spaces at the end. Anything else: `null` (that text is not editable).
  - `codeRange(source, shown)`: inline code: the range inside the backticks when it holds exactly
    the shown text, else `null`.
  - `bodyOffset(fileText, source)`: where the page source starts in the file (0 when the lengths
    are equal, else the last place the source is found; -1 when not found).
  - `escapeTyped(text, { code, cell, heading, mdx, lineStart })`: the typed text as Markdown that
    shows exactly that text (rules in Implementation notes).
  - `applyEdits(fileText, edits, allowed, { mdx })` -> `{ text }` or `{ error, message }`: all or
    nothing. Each edit `{ s, e, before, after }` must be one of the `allowed` ranges (from the
    built page), not overlap another, and `before` must line up with the file at that range. Only
    the part between the common start and end of `before` / `after` is replaced, mapped through
    `alignText`; the new part goes through `escapeTyped`. A piece emptied completely that is the
    only text of a bold / italic / struck / link / code element removes the whole element (its
    `outer` range), so no empty `****` is left. Bold / italic text loses spaces typed at its two
    ends (they would undo the formatting).
  - `titleRange(fileText)` and `yamlScalar(value)`: the page title (`title:` line of the
    frontmatter, one line, plain or quoted) as an editable range; a new title is written plain
    when safe, otherwise in double quotes.
- New `templates/docs/src/page-edit/page-edit.mjs`: integration `pageEdit()`. On Astro 7 it adds
  a Sätteri `hastPlugins` entry (like `diagrams()` adds its `mdastPlugins` entry); on an older
  Astro it does nothing. Per page (`.md` / `.mdx` with a file): each text piece with a position,
  not inside `pre`, `script`, `style`, `svg`, `textarea`, whose source lines up, is wrapped in
  `<span data-kit-src="S-E">` (file offsets), with `data-kit-kind` letters when needed (`c`
  inline code, `t` table cell, `h` heading, `e` only text of bold / italic / struck) and
  `data-kit-outer="S-E"` (the element to remove when emptied).
- `templates/docs/astro.config.mjs`: `import pageEdit from './src/page-edit/page-edit.mjs';` and
  `pageEdit(), // page text editable in the browser (Edit button; only when the docs server allows it)`
  before `starlight({`.

### Browser: Edit, Discard, Save
- New `templates/docs/src/components/PageEdit.astro`, used by `PageTitle.astro` on the left of
  the page actions. At build time: the page's file (`entry.filePath`), its SHA-256, the title and
  its range (`titleRange`). The Edit button (pencil + "Edit", same look as "Copy page") stays
  hidden until `GET /_kit/edit` answers `{ "enabled": true }` and the page has editable text, so
  a mirror or a static copy of the site never shows it.
  - Edit: every `span[data-kit-src]` of the page content and the title become editable
    (`contenteditable="plaintext-only"`, `true` where not supported), the Edit button hides, a bar
    fixed at the bottom shows "Editing: click a text to change it", **Discard**, **Save**
    (accent). Hover: a thin dotted outline on editable text; focus: accent outline; changed text:
    a light accent background; code blocks, diagrams and pictures are faded while editing.
  - Enter / line breaks blocked (one hint in the bar); paste = plain text on one line; drop
    blocked; a click on a link places the cursor instead of opening it; Ctrl+S / Cmd+S saves;
    leaving the page with changes asks first (browser prompt). The bar counts the changes.
  - Discard: every text back as it was, edit mode off (no question).
  - Save: `POST /_kit/edit` with `{ page: location.pathname, edits: [{ s, e, before, after }] }`,
    the bar says "Saving… the website is being rebuilt"; done: the page reloads and the bar shows
    "Saved (version abc1234)" for 4 s. A refusal or error: its message in the bar, edits kept.
  - Labels in English, or French on French pages. Not printed.
- New `templates/docs/src/scripts/page-edit.mjs` (pure, tested): `parseRange`, `collectEdits`,
  `cleanPaste`, `changesLabel`, `errorMessage` (EN / FR).
- `templates/docs/src/components/PageTitle.astro`: the row is title + a group (PageEdit, then
  PageActions), so Copy page keeps its place when Edit appears.

### Server: saving
- New `lib/docs-edit.mjs`, used by `lib/docs-serve.mjs` for `/_kit/edit`:
  - The project: the git project holding the docs folder (`dist/`'s parent); editing is on when
    its `.agentkit` says `DOCS_EDIT=on` (read on each request: on / off needs no restart).
  - `GET /_kit/edit` -> `{ "enabled": true|false }`.
  - `POST /_kit/edit`, checked in this order, nothing written on any refusal: editing on;
    `Host` is an IP address, `localhost` or a name in `DOCS_EDIT_HOSTS` (no DNS rebinding);
    `Origin` present and the same host; header `X-Kit-Edit: 1` and JSON (other websites can't
    send it from the owner's browser); body at most 1 MB; the page's built HTML found in `dist/`
    gives the file, the hash and the allowed ranges (the browser's own claims are never
    trusted); the file is a `.md` / `.mdx` inside `src/content/`; its hash is still the built one
    (else "the page changed since it was built: reload it"); it has no changes waiting in git
    (else "save them first"); `applyEdits` accepts the edits.
  - Then: write the file, run `kit docs build` (the kit next to the server; `HOME` and `PATH` set
    for it). Build failed: the file is put back (the old website stays), the error is returned.
    Built: `git commit` of that file only, message `docs: edit "<page title>" in the browser`;
    the answer gives the short version id. One save at a time (the next one waits).
- `lib/docs-serve.mjs`: exports `startDocsServer(dist, port, options)` (tests pass a fake
  build); run as before from the command line; POST only for `/_kit/edit`.

### kit command, upgrade, docs
- `bin/kit`: `kit docs edit on|off|status`: sets `DOCS_EDIT` in `.agentkit`, saves that file
  alone in git (when git tracks it or it is new), restarts the docs service when there is one,
  and says who can then edit ("anyone who can open <url>"). `kit help`.
- `lib/docs-upgrade.mjs`: `PageTitle` also brings `src/components/PageEdit.astro`,
  `src/scripts/page-edit.mjs`; new `KIT_PAGE_EDIT` (integration + `src/page-edit/*.mjs`) added
  to `astro.config.mjs` like `images()`; the components comment mentions editing.
- `README.md`: the feature, `kit docs edit`, the `.agentkit` settings, who can edit.

## Tests to add or update
New `tests/test-page-edit.mjs` (temp folders, a fake build, local server on port 0, no network,
no browser):
- `alignText`: same text; smart quotes / dashes / ellipsis; escapes; entities; blockquote and
  list continuation lines; trailing spaces; failures give `null`.
- `escapeTyped`: each rule (text, code, cell, heading, MDX braces, line start, newlines, NBSP).
- `applyEdits`: a word changed keeps the rest of the file identical; changes next to smart
  quotes / escapes; two edits in one save; emptied bold removes `**…**`; range not allowed,
  overlap, `before` not matching -> error and nothing changed; backtick typed in code refused;
  `{` in MDX escaped.
- `titleRange` / `yamlScalar`: plain, quoted, a title with `:` or `#`.
- The page plugin with a fake Sätteri context: spans and kinds; `pre` text skipped; offsets
  moved by the frontmatter.
- Server: `GET` off / on; `POST` refused (off, other Host, other Origin, no header, unknown page,
  hash changed, file not saved in git, bad edits); a good save changes the file, calls the build,
  commits only that file; a failed build puts the file back.
- `kit docs edit on/off` in a temp git project: `.agentkit` line and its save.
- Templates and upgrade: the config has `pageEdit()`, PageTitle uses PageEdit, every new file
  has the marker, no addresses; `upgradeDocs` adds the integration and files once.
`tests/test-docs-features.mjs`: the exact-template checks updated for the new config lines.

## Acceptance checks
- [ ] `scripts/test.sh` passes
- [ ] A throwaway docs site (this work copy's template, Astro 7) builds; its pages carry
      `data-kit-src` spans whose ranges hold their text (checked for every span of every page)
- [ ] Docs playground site (a permanent test site in the kit's container, editing on): in a
      headless browser, Edit, type in a paragraph, a bold word, a table cell, inline code, the
      title, Save: the file has only those changes, the page shows them, git has the version;
      Discard puts the text back; Enter adds nothing
- [ ] Another website (other Origin) can't save; with `kit docs edit off` the button is gone
- [ ] Owner, in a browser: edit and save a page of the playground

## Implementation notes
- Public repo: no project names, addresses or host names in kit files or this spec.
- `escapeTyped` rules: newlines and tabs -> space, NBSP -> space, other control characters
  removed. Text: `\` `` ` `` `*` `[` `]` `<` `~` always escaped; `_` unless between two letters
  or digits; `&` before an entity-like `name;`; `|` in table cells; `#` in headings; `{` `}` in
  MDX; at a line start (only spaces, `>` and list markers before it on its line): leading spaces
  dropped and a first `#` `>` `-` `+` `=` `:` escaped, `1.` / `1)` -> `1\.` / `1\)`. Code: a
  backtick is refused, `|` escaped in table cells, nothing else.
- The server reads the allowed ranges from the built HTML with a fixed pattern (our own
  attributes). It never trusts the browser's ranges or kinds: MDX text with an unescaped `{`
  would run code at build time.
- Astro caches rendered pages in `node_modules/.astro/data-store.json`: adding `pageEdit()` to
  the config clears it; after a later change to the plugin, delete it before building.
- Style: short plain comments, LF line endings, labels EN / FR like the other components.
