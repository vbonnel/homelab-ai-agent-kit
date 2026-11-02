# Docs page actions: Claude / ChatGPT on every docs website

Status: ready to merge
Size: small
Database change: no
New settings (.env keys): none
Restart needed after merge: no (projects get it with `kit update`, then `kit docs upgrade` through `/feature`)

## Goal
The owner wants "Open in Claude" and "Open in ChatGPT" in the page actions menu of every docs
website, also the ones that are only on the local network (until now only sites with `site:` had
them, because those services can't read a local address).

## Changes
- `templates/docs/src/components/PageActions.astro`:
  - the two items are always there;
  - site with `site:`: as before (prompt + public address of the page's `.md` file);
  - site without `site:`: the item (`data-pa-paste`) copies the page (same copy as "Copy page",
    the main button shows "Copied!"), then opens the service in a new tab with a prompt in the
    page's language ending with "pasted below:"; the reader pastes with Ctrl+V. Hint under the
    item: "Copies the page: paste it with Ctrl+V" (fr: "Copie la page : collez-la avec Ctrl+V").
    The page text is never put in the address (length limits). The tab opens even if the copy
    failed.
- `README.md`: the docs website paragraph.

## Not doing
- No page text in the URL; no change for sites with `site:`.

## Tests to add or update
- `tests/test-docs-features.mjs`: the items are not conditional on `site:`, the paste path exists.

## Acceptance checks
- [x] Local site: both items in the menu, with the paste hint; public site: address prompt as before
- [x] `scripts/test.sh` passes
- [ ] Owner: on a local site, the item copies the page and opens Claude / ChatGPT with the prompt
