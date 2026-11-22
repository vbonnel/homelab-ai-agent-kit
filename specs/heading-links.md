# Edit button: renaming a heading keeps the links to its section working

Status: planning
Size: normal
Database change: no
New settings (.env keys): none
Restart needed after merge: the docs website service (new server code; `kit docs edit on` restarts it)

## Goal
A heading's anchor comes from its text: renaming "Table" to "Service table" in the browser turns
`#table` into `#service-table`, and links elsewhere to `/page/#table` silently open the page at
its top (checked on the playground). Docs sites use many such links (one has 125). The owner
chose: links in the site's pages that pointed to the renamed section are updated in the same save
(one git version); when one can't be updated, the save is refused and says which link.

## Not doing
- Links from outside the website (bookmarks, other sites) can't be updated.
- Links in the sidebar settings (`astro.config.mjs`) or made by components are not rewritten: a
  save that would break one is refused.
- Saves that change no heading work exactly as before (no extra check, no extra time).

## Changes
- New `lib/docs-links.mjs` (no packages):
  - `headingIds(html)`: the ids of a built page's headings, in order (h1-h6 with an id).
  - `renamedSections(oldIds, newIds)` -> Map old id -> new id for the headings whose id changed
    (same number of headings; text edits never add or remove one; otherwise an empty map).
  - `contentLinks(html, fromUrl)`: the links of the page text (between `sl-markdown-content` and
    Starlight's footer; the `#` links next to headings left out), each `{ path, fragment }`
    resolved against the page's address; external links left out.
  - `siteLinks(dist)`: every built page's address, file, heading ids and content links.
  - `brokenLinks(site)`: content links to a page or a section that does not exist ("from|href").
  - `rewriteSectionLinks(text, fromUrl, targetUrl, renamed)` -> `{ text, count }`: in a page's
    Markdown, link destinations (`](…)`, `[ref]: …`, `href="…"`) that lead to `targetUrl` with a
    renamed fragment get the new one (all renames at once). Fenced code blocks are left alone.
- `lib/docs-edit.mjs`, when a save changes a heading (an edit of a range of kind `h`):
  1. before writing: the edited page's heading ids and the site's links (old website);
  2. write, build; the new heading ids give the renamed sections; the links to them from page
     text (S, per linking page) must be updated;
  3. each linking page's source (`data-file` of its built page; the edited file included) is
     rewritten with `rewriteSectionLinks`; a linking page with no source, with changes not saved
     in git, or where fewer links were rewritten than S has -> refused;
  4. build again; check: no link broken that wasn't before, and every linking page now links to
     the new ids -> else refused;
  5. refused: every written file put back and the website built again (it matches the files);
     error `links` with the links that could not be updated;
  6. saved: one git version with the edited page and the updated pages, message
     `docs: edit "<title>" in the browser (links updated in N pages)`; the answer gives the count.
  `saveInGit` takes several files.
- `templates/docs/src/scripts/page-edit.mjs`: `links` error message (EN / FR, names the first
  link that could not be updated); `savedMessage` adds "N links to renamed sections updated".
- `templates/docs/src/components/PageEdit.astro`: passes the answer's details to those messages.
- `README.md`: one sentence on headings and links.

## Tests to add or update
`tests/test-page-edit.mjs`: `headingIds`, `renamedSections` (rename, duplicate-id shift),
`contentLinks` (TOC / sidebar / anchor links ignored, relative paths), `brokenLinks`,
`rewriteSectionLinks` (other page, same page `(#x)`, relative `../`, reference definition, `href`,
title after the destination, code fence untouched, other pages' anchors untouched). Server, with a
fake build that writes the "built" pages from the sources: a heading rename with a link from
another page -> both files saved in one git version; a link only in the sidebar -> refused, files
back, the build run again; a linking page with unsaved changes -> refused.

## Acceptance checks
- [ ] `scripts/test.sh` passes
- [ ] Playground (real build): renaming "Table" updates the home page's `/editing-test/#table`
      link in the same version; the site has no broken link; a normal text save is unchanged
- [ ] Owner, in a browser: rename a linked heading
