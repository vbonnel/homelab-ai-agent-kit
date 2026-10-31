# Docs websites: open the page images full screen in the diagram viewer

Status: approved
Size: normal
Database change: no
New settings (.env keys): none
Restart needed after merge: no (containers get it with `kit update`; each project then runs
`kit docs upgrade` through `/feature`)

## Goal
In a kit docs website, clicking a picture in a page (a photo or screenshot written as
`![text](./picture.png)`) opens it full screen in the same viewer as the diagrams: zoom (wheel,
pinch, + / -, double click, keys), move (drag, arrows), Fit, Esc to close. Diagrams and pictures
look and work the same, with no new npm package.

## Not doing
- No "Enlarge" button on pictures (it would clutter pages with many photos): the picture itself is
  the button (zoom-in pointer, reachable with Tab, Enter or Space opens it).
- No gallery (next / previous picture), no captions in the viewer.
- No new npm package, no change to Starlight, Astro or pele.
- The file keeps its name `diagram-zoom.mjs` (a new name would leave the old file behind in the
  projects that upgrade).
- No browser tests (as before): the sums are tested, the viewer is checked by the owner in a browser.

## Current situation
- `templates/docs/src/scripts/diagram-zoom.mjs` (loaded by `components/MarkdownContent.astro` on
  every page) finds `div.kit-diagram, pre.mermaid`, adds an "Enlarge" button, and on open copies the
  diagram's `<svg>` into a `<dialog>`, sized from its viewBox, fitted with `fitView` from
  `zoom-math.mjs`.
- Pictures in the pages are plain `<img>` (Astro makes them `.webp`, `loading="lazy"`), with no zoom.

## Changes
- `templates/docs/src/scripts/zoom-math.mjs`: `fitView(content, stage, pad = 24, most = Infinity)`:
  the fitted scale is never above `most`. Pictures pass `most = 1`: a small picture is shown at its
  own size, not blown up (blurry); diagrams (drawings that stay sharp) keep growing to fill the screen.
  The existing calls and results are unchanged.
- `templates/docs/src/scripts/diagram-zoom.mjs`:
  - New `PICTURES = '.sl-markdown-content img'`. A picture is left alone when it is inside a link or
    a button (the click keeps its job), inside a kit diagram, inside an element made by the
    `starlight-image-zoom` add-on (`starlight-image-zoom-zoomable`: a site that still uses it gets no
    double viewer), marked `data-zoom="off"`, `data-zoom-off` (the add-on's own mark) or class
    `no-zoom`, or small (48 x 48 pixels or less: icons). A picture not
    loaded yet (lazy) is checked again when it loads.
  - Each picture kept gets class `image-zoom`, `tabindex="0"`, a hover text "Click to enlarge";
    click, Enter or Space opens it.
  - `open(item)` handles both kinds: a diagram as today; a picture: an `<img>` copy in the viewer
    (`currentSrc`, so the best size Astro made; same `alt`; not draggable by the browser), sized from
    its own pixel size (`naturalWidth` / `naturalHeight`), fitted with `most = 1`. A picture that
    has not loaded (still downloading or broken) is opened once it loads, or not at all if it fails.
  - The viewer's label and Fit button say "picture" or "diagram" depending on what is open.
  - After closing, the focus goes back to the picture or diagram (keyboard users don't lose their
    place). The viewer is still made once, on the first open.
- `templates/docs/src/components/MarkdownContent.astro`: comment updated (diagrams and pictures);
  styles: `img.image-zoom { cursor: zoom-in }`, a focus ring with the accent colour,
  `.diagram-zoom-layer > img { display: block; max-width: none }`.
- `README.md`: the docs website line says pictures open in the same viewer; the upgrade text names
  "picture zoom" with the other docs features.

## Tests to add or update
In `tests/test-docs-features.mjs` (no browser, no network):
- `fitView` with `most = 1`: a picture smaller than the viewer is shown at its own size, centred;
  a picture bigger than the viewer fits inside it with the padding, as before; without `most` the
  results are the same as today (the existing fit tests stay as they are).
- Template check: the viewer has the pictures selector, the skip rules (link, `data-zoom="off"`,
  `no-zoom`, the add-on's element), keyboard opening, and `most = 1` for pictures; MarkdownContent
  has the `img.image-zoom` style.

## Acceptance checks
- [ ] A picture in a page opens full screen in the viewer, zooms and moves like a diagram, Esc closes
- [ ] Pictures in links, icons, pictures marked `data-zoom="off"` and diagrams' own pictures don't open
- [ ] A small picture is shown at its own size; a big one fits the screen
- [ ] Diagrams work as before
- [ ] No address, host name or project detail in the changed files
- [ ] `scripts/test.sh` passes

## Implementation notes
- LF line endings, short plain comments like the rest of the kit; all three files keep their
  `agent-kit: managed file` marker.
- Files written from the Proxmox host into CT 108: `chown 100000:100000` before `kit save`.
- After the merge: push to GitHub (owner's token), then `kit update` in the containers and
  `kit docs upgrade` in each project through `/feature`. The Fablab website (pae-docs) can then drop
  its `starlight-image-zoom` add-on in its own feature; until it does, its pictures keep using the add-on.
