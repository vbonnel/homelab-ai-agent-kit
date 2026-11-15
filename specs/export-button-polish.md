# Docs websites: a clearer, more polished Export button

Status: approved
Size: small
Database change: no
New settings (.env keys): none
Restart needed after merge: no (projects take it with `kit docs upgrade`)

## Goal
The owner wants the top bar's Export button to look finished and to say what it exports: the
whole documentation, not just the page.

## Changes
- `templates/docs/src/components/SocialIcons.astro` (the button only; the exported file is unchanged):
  - Label **Export docs** (French: **Exporter la doc**), followed by a small grey **.md** tag (the
    file format).
  - Icon: a page with a down arrow (instead of a plain arrow).
  - Hover text with the number of pages: "Download all 6 pages of the docs as one Markdown file,
    for AI tools" (1 page: "the 1 page"); French: "Télécharger les 6 pages de la doc en un seul
    fichier Markdown, pour les IA".
  - Same look as the "Copy page" button next to page titles: rounded corners (0.75rem), thin grey
    border, page background, medium weight text, grey -> white on hover, accent focus ring.
  - States, each with its icon, the width never changing: Export docs -> **Exporting…** (a small
    turning circle; still when the reader asked for less motion) -> **Downloaded** (tick, accent
    colour, 2 s) or **Export failed** (cross, 2 s). French: Export…, Téléchargé, Échec de l'export.
    Screen readers hear each state (status line, as today).
- `README.md`: "**Export docs** button".

## Tests to add or update
`tests/test-docs-features.mjs`, template check of the Export button: the two labels, the `.md`
tag, the page count in the hover text, the four states (idle / busy / done / failed), the
reduced-motion rule.

## Acceptance checks
- [ ] Test site rebuilt and served again at the same address: the new button in the top bar and
      the phone menu
- [ ] `scripts/test.sh` passes
- [ ] Owner, in a browser: the button looks right in light and dark, and the states show
