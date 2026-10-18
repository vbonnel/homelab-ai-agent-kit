# Docs websites: diagram zoom and a version pill, for new and existing projects

Status: planning
Size: normal
Database change: no
New settings (.env keys): none
Restart needed after merge: no (containers get it with `kit update`; each existing project then
runs `kit docs upgrade` through `/feature`)

## Goal
Two features were built and used for a while in one project's docs website. Every docs website made
by the kit should have them:
1. **Diagram viewer**: each Mermaid diagram gets an "Enlarge" button (clicking the diagram works too)
   that opens it full screen, where it can be zoomed (wheel, pinch, + / -, double click, keys) and
   moved (drag, arrows). Pages without diagrams don't change.
2. **Version pill**: next to the site title in the top bar, the short id of the git save the website
   was built from; its hover text gives the save date, and it links to the changelog. Two sites (or a
   mirror) showing the same pill serve the same copy.

New projects get both from `kit docs init`. Existing projects get them with a new command,
`kit docs upgrade`, which adds the files and two lines to `astro.config.mjs` and never touches pages.

## Not doing
- The project's other docs extras (links that open in a new tab, a component for switch-port
  pictures): not asked.
- No change to Starlight, Astro or Mermaid versions; no new npm package.
- `kit update` does not change projects by itself: each project takes the features through `/feature`
  (work copy, build, merge), like any other change.
- No browser tests: the viewer's sums are tested, the viewer itself was used in a real browser.

## Current situation
- `kit docs init` copies `templates/docs/` (`astro.config.mjs` with the title filled in,
  `content.config.ts`, `package.json`, five pages), installs the packages and builds.
- Starlight lets a site replace its components in `astro.config.mjs`
  (`starlight({ components: { SiteTitle: ..., MarkdownContent: ... } })`). The two features are two
  such components, wrapping Starlight's own: nothing of Starlight is copied.

## Changes
- New kit-managed files under `templates/docs/src/` (copied to `<docs>/src/`), from the project where
  they were built, made generic (no project names or addresses):
  - `components/SiteTitle.astro`: Starlight's `SiteTitle`, then the pill (`<a href="/changelog/">`,
    styles from Starlight's accent colours, never cut on narrow screens).
  - `version.mjs`: `docsVersion(dir = process.cwd())` -> `{ id, saved }` from
    `git log -1 --format=%h|%cd`; empty values (pill says "unknown") when there is no git history: the
    build never fails because of the version.
  - `components/MarkdownContent.astro`: Starlight's `MarkdownContent` plus the viewer script and its
    global styles.
  - `scripts/diagram-zoom.mjs`: the viewer (`<dialog>`, button per `pre.mermaid`, copies the drawn SVG
    with renamed ids so nothing clashes with the page).
  - `scripts/zoom-math.mjs`: `fitView`, `zoomLimits`, `zoomAt` (pure functions, tested).
  Each file has a marker line `agent-kit: managed file` saying `kit docs upgrade` keeps it current,
  and that deleting the line keeps the project's own version.
- `templates/docs/astro.config.mjs`: `components: { SiteTitle, MarkdownContent }` with a short comment.
- New `lib/docs-upgrade.mjs` (Node, standard library only), used by `kit docs init` and
  `kit docs upgrade`, and exporting its functions for the tests:
  - `addComponents(configText)` -> `{ text, added, kept, problem }`. Adds each missing entry
    (`SiteTitle`, `MarkdownContent`) to an existing `components: {` block inside `starlight({`, or
    adds the whole block after the `title:` line, with that line's indentation. An entry the project
    already sets to another file is kept and reported. When `starlight({` or its `title:` line can't
    be found: no change, and `problem` says what to add by hand.
  - `upgradeDocs(docsDir, templateDir)`: checks the config first (nothing is written if it has a
    problem); then for each kit file: missing -> copied; present with the marker -> replaced by the
    kit's version; present without the marker -> kept (the project's own). Then writes the config if
    it changed. Returns a list of what it did. Pages and other files are never touched.
  - Run as `node lib/docs-upgrade.mjs <docsDir>`: prints one line per action, exit 1 on a problem.
- `bin/kit`:
  - `kit docs init`: after copying the template, runs `lib/docs-upgrade.mjs` (copies the kit files;
    the template config already has the entries).
  - new `kit docs upgrade`: allowed in the real project and in a work copy (so `/feature` can use it);
    runs `lib/docs-upgrade.mjs` on the project's docs folder (`DOCS_DIR`), then says to run
    `kit docs build`. Usage line and `kit help` updated.
- `claude/settings.json`: allow `Bash(kit docs upgrade)`.
- `README.md`: the docs website section says what the two features are and how an existing project
  gets them (`kit update` once per container, then in each project:
  `/feature add the kit's docs features (kit docs upgrade)`); `kit docs upgrade` in the command table
  and the file list.

## Tests to add or update
New `tests/test-docs-features.mjs` (`node:test`, run by `scripts/test.sh`; temp folders only, no
network, no npm install, no browser):
- Zoom sums: fit keeps the whole diagram inside with padding, centred, as big as possible (wide,
  tall, small); an undrawn diagram (size 0) gives a usable view; zooming keeps the point under the
  pointer in place, in then out gives the start view back, limits hold (at least 4x).
- Version: on a throwaway git repo with a merge, `docsVersion` gives the merge's short id and its
  date; the same twice; a folder without history gives empty values without an error.
- Template: `astro.config.mjs` sets both components; each kit file exists, has the marker, and the
  components load the viewer / show the pill linked to the changelog.
- `addComponents`: the kit's previous template config (no `components`) gets the block after
  `title:`, with the right indentation, and the result still has every other line; a config with a
  `components: {` block of its own (another component) gets the two entries added inside and keeps
  its own; an entry pointing to another file is kept; running it twice changes nothing the second
  time; a config without `starlight({` gives a problem and the text unchanged.
- `upgradeDocs` on a fake docs folder (old template config, pages, a custom `SiteTitle.astro`
  without the marker, an outdated kit `zoom-math.mjs` with the marker): pages unchanged byte for
  byte, missing files copied, the marked file replaced, the custom file kept and reported, config
  updated; a second run reports nothing to do; a broken config: nothing written at all.
- `kit docs upgrade` through `bin/kit` in a throwaway git repo with a fake docs folder: exit 0, files
  added; run from a work copy (git worktree) it changes the work copy only.

## Acceptance checks
- [ ] A new project gets both features from `kit docs init`
- [ ] `kit docs upgrade` adds them to an existing docs website without touching its pages, keeps
      files the project made its own, and can be run again safely
- [ ] An existing website with the old template builds with the upgrade (checked by hand on one
      real project before the push)
- [ ] No address, host name or project detail in the new files
- [ ] `scripts/test.sh` passes

## Implementation notes
- `bin/kit` and the new files: LF line endings (`lib/consult.mjs` alone uses CRLF; not touched).
- Style: short plain comments like the rest of the kit.
- After the merge: push to GitHub (owner's credentials), then in each container `kit update`, and in
  each project with a docs website `/feature` with `kit docs upgrade`, `kit docs build`, merge.
