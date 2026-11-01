# Docs viewer: no Enlarge button on diagrams

Status: ready to merge
Size: small
Database change: no
New settings (.env keys): none
Restart needed after merge: no (projects take it with `kit docs upgrade`)

## Goal
The owner wants diagrams to work like pictures: click (or Tab + Enter / Space) opens the viewer,
a click closes it. The "Enlarge" button above each diagram is removed.

## Changes
- `templates/docs/src/scripts/diagram-zoom.mjs`: no button (and no icon); the diagram keeps its
  wrapper (spacing), gets `tabIndex = 0`, the hover text "Click to enlarge", and opens on Enter or
  Space as well as on a click (not when text was just selected, as before).
- `templates/docs/src/components/MarkdownContent.astro`: button styles and the print rule removed;
  a focus ring on the diagram (accent colour), like pictures.
- `templates/docs/astro.config.mjs`, `lib/docs-upgrade.mjs` (comment added to configs), `README.md`:
  no "Enlarge" button in the text. `addComponents` also rewrites the comment an older kit wrote
  (the two lines about the "Enlarge" button) to the new one, with its indentation, once.

## Tests to add or update
`tests/test-docs-features.mjs`: no button, no `Enlarge` text in the viewer; the diagram is
focusable and opens on keydown and click; the focus ring style; no "Enlarge" button text in the
template config or the README; an older config's comment is brought up to date once (the
addComponents and useKitDiagrams tests use the upgraded fixture).

## Acceptance checks
- [x] No Enlarge button; a diagram opens on click or Tab + Enter, a click closes the viewer
- [x] `scripts/test.sh` passes
