# Docs websites: copy a diagram as its Mermaid code

Status: approved
Size: small
Database change: no
New settings (.env keys): none
Restart needed after merge: no (containers get it with `kit update`; each project then runs
`kit docs upgrade` through `/feature`)

## Goal
The owner wants to copy one diagram as its Mermaid code. Today the full-screen viewer only has
**Copy SVG** / **Save SVG**, and the page's "Copy page" copies the whole page. The viewer gets a
**Copy code** button that copies the Mermaid code of the diagram that is open, and nothing else.

## Not doing
- No button on the page itself (the owner removed on-page buttons in `no-enlarge-button`): the
  button is in the viewer bar, like Copy SVG.
- The copy is the Mermaid code only, without the ```` ```mermaid ```` / ```` ``` ```` lines
  (ready for mermaid.live, a Mermaid import, or a ```` ```mermaid ```` block).
- Pictures (photos / screenshots): no Copy code, as today for Copy SVG.
- Sites still drawing with astro-mermaid: the button stays hidden (the code is no longer on the
  page once drawn). Every kit docs site draws with pele today.
- No change to "Copy page", the `.md` pages or the Export button. No new npm package.
- No browser in this container: pure parts are tested here; clicking and pasting are checked by
  the owner in a browser.

## Changes
- `templates/docs/src/diagrams/draw.mjs`:
  - New `sourceAttribute(text)`: the Mermaid code made safe for an HTML attribute value: `&`
    `"` `<` `>` as entities, line breaks as `&#10;` (Windows `\r\n` -> `\n`), tabs as `&#9;`, so
    nothing on the way (Astro, HTML minifiers) can change the lines.
  - `drawCode`: the box gets the code: `<div class="kit-diagram" data-diagram="flowchart"
    data-source="...">`. The code is the block as written in the page (`node.value`).
- `templates/docs/src/scripts/diagram-zoom.mjs`:
  - New bar button **Copy code** before Copy SVG (hover text "Copy code: the diagram's Mermaid
    code"), same three labels as Copy SVG (Copy code / Copied! / Copy failed, fixed width), shown
    only for a diagram that has `data-source` (hidden for pictures and astro-mermaid diagrams).
  - The copy part of `copySvg` becomes a shared `copyText(button, text, message)`: clipboard on
    HTTPS, the hidden textarea inside the dialog on plain HTTP, the button state for 2 s, the
    `role="status"` line ("Mermaid code copied" / "Copied! Paste it into Figma or Penpot" /
    "Copy failed"). Each button keeps its own 2 s timer; closing the viewer resets both.
  - The code comes from the diagram on the page (`current.dataset.source`): the browser has
    already turned the entities back into the real characters and lines.
  - Header comment mentions Copy code.
- `templates/docs/src/components/MarkdownContent.astro`: comment mentions Copy code. The
  existing `.diagram-zoom-copy` style is reused (no new CSS).
- `README.md`, `bin/kit` help text, `lib/docs-upgrade.mjs` header comment: "Copy code" next to
  Copy / Save SVG. The `astro.config.mjs` comment is left as it is (no config change for sites).

## Tests to add or update
`tests/test-docs-features.mjs` (temp folders only, no network, no browser):
- `sourceAttribute`: `&`, `"`, `<`, `>`, line breaks, `\r\n`, tabs; a decode of the result (the
  HTML attribute rules) gives the code back exactly.
- `drawCode`: the existing exact-output checks now include `data-source="..."`; a code with
  quotes and `-->` / `<br>` labels stays inside the attribute (no `"` or `<` left in it).
- `drawDiagrams`: the box of each block has its own code.
- Template check: the viewer has `'Copy code'`, reads `dataset.source`, hides the button when
  there is none, and Copy SVG / Copy code both go through `copyText`.

## Acceptance checks
- [ ] Throwaway docs site (this work copy's template, `kit docs init` steps, temp folder) builds;
      a page with a diagram has `data-source` on its `.kit-diagram`, and reading that attribute
      back (HTML parsing rules) gives exactly the page's ```` ```mermaid ```` block
- [ ] `scripts/test.sh` passes
- [ ] Owner, in a browser: open a diagram, Copy code, paste: the Mermaid code of that diagram only

## Implementation notes
- Style: short plain comments like the rest of the kit; LF line endings; generic files (public
  repo: no project names, addresses or host names).
- `data-source` is on the `.kit-diagram` box, never on the `<svg>`: Copy SVG / Save SVG and the
  viewer's copy of the picture are unchanged.
