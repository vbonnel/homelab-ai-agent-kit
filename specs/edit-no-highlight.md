# Edit button: no highlight on changed text, no scrollbar when editing starts

Status: building
Size: small
Database change: no
New settings (.env keys): none
Restart needed after merge: no (sites get it with `kit docs upgrade` through `/feature`)

## Goal
Two things the owner noticed while editing a page in the browser:
- Changed text gets a purple (accent) background: the owner does not want it. The bar at the
  bottom still counts the changes.
- Clicking Edit can make a scrollbar appear: edit mode adds 6rem of space under the page
  (`padding-bottom` on `body`) so the bar never hides the end of the page; a page that just fit
  the window becomes taller than it (a longer page gets 96 px longer). That space goes; instead
  `scroll-padding-bottom: 6rem` on the page while editing, which changes no layout and only keeps
  the text being typed in above the bar when the browser scrolls to it.

## Not doing
- The dotted outline on hover and the accent outline around the text being typed in stay.
- No other change to editing or saving.

## Changes
- `templates/docs/src/components/PageEdit.astro`:
  - the script no longer adds / removes the `kit-edit-changed` class (the input handler only
    updates the count in the bar); its CSS rule is removed;
  - `:root.kit-editing body { padding-bottom: 6rem }` replaced by
    `:root.kit-editing { scroll-padding-bottom: 6rem }`; the header comment and the style
    comment no longer mention the changed-text background.

## Tests to add or update
`tests/test-page-edit.mjs`, template test: no `kit-edit-changed` and no `padding-bottom` on the
body in PageEdit.astro; `scroll-padding-bottom` while editing.

## Acceptance checks
- [ ] `scripts/test.sh` passes
- [ ] Playground, headless Chromium: clicking Edit leaves the page height unchanged (a page that
      fits the window gets no scrollbar); changed text has no background; the 19 editing checks
      still pass
- [ ] Owner, in a browser: no purple background, no scrollbar on Edit
