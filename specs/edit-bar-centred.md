# Edit button: the bottom bar centred on the window

Status: approved
Size: small
Database change: no
New settings (.env keys): none
Restart needed after merge: no (sites get it with `kit docs upgrade` through `/feature`)

## Goal
The owner finds the editing bar (Discard / Save, at the bottom) off-centre: it is centred on the
part of the window right of the sidebar (Starlight's `--sl-content-inline-start`), so on a wide
screen it sits to the right. It becomes centred on the window.

## Not doing
- Same size (at most 44rem wide), same place at the bottom, same phone layout (full width).
- No other change.

## Changes
- `templates/docs/src/components/PageEdit.astro`: `.kit-edit-bar` gets `inset-inline: 1rem`
  (was `calc(var(--sl-content-inline-start, 0px) + 1rem) 1rem`); with `max-width` and auto margins
  it is centred on the window. It is drawn over the sidebar where they meet (it lives in the page
  body, z-index 15 over the sidebar's 5). Comment updated.

## Tests to add or update
`tests/test-page-edit.mjs`, template test: the bar's rule has `inset-inline: 1rem;` and no
`--sl-content-inline-start`.

## Acceptance checks
- [ ] `scripts/test.sh` passes
- [ ] Playground, headless Chromium, 1280 / 1600 / 900 px wide windows: the bar's left and right
      gaps to the window edges are equal; on a phone it is full width; the 19 editing checks pass
- [ ] Owner, in a browser: the bar is centred
