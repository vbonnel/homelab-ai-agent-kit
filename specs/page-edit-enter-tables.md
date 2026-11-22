# Docs page editing: Enter like a word processor, table cells easy to click, no outlines

Status: building
Size: normal
Database change: no
New settings (.env keys): none
Restart needed after merge: the docs website service (new server code); sites take the browser
and build part with `kit docs upgrade` (`/feature`, by hand).

## Goal
The owner tried the Edit button (kit `page-edit`) on real sites and asked (2026-11-21):
1. Enter must work: like a word processor (owner's choice): **Enter = new paragraph**,
   **Shift+Enter = new line in the same paragraph**. In a table cell both give a new line (a
   cell can't hold paragraphs). In a list item Enter starts a new item.
2. Table text must be easy to edit: a click anywhere in a cell (not only right on its words)
   puts the cursor in its text.
3. No outline around the text that can be changed or the one being typed in: only the text
   cursor (the I-beam on hover, the blinking caret where typing).

## Not doing
- Enter in a page title, a heading, bold / italic / struck text, a link or code: a hint in the
  bar instead (those would break the formatting). Pasted text stays on one line.
- Empty paragraphs: Enter at the very start or end of a paragraph adds nothing; several Enters
  in a row are one paragraph break (Markdown has no empty paragraphs).
- No live look of the result while typing: a new paragraph shows as an empty line, a new list
  item too; after Save the page reloads with the real result.
- Sites built before this change (no new mark) keep the old rule: no new lines there.
- Family-finance-style tables drawn by a site's own components from data files: not Markdown,
  not editable (a project feature, not the kit's).

## Changes
### Build (`templates/docs/src/page-edit/page-edit.mjs`)
- New kind letter `b` (breaks allowed): text whose direct parent is `p`, `li`, `td` or `th`
  (so not inside bold / italic / struck / link / code, not a heading).

### Markdown (`templates/docs/src/page-edit/markdown-text.mjs`)
- The browser sends a typed line break as U+2028 in `after` (not `\n`: the shown text already
  holds the source's own line ends). A run of 2 or more = a paragraph break, 1 = a line break.
- `editPart`: in a range without `b`, breaks become spaces (as before). With `b`:
  - table cell (`t`): each break -> `<br />`.
  - else, from the file around the place (`breakContext`): the line's quote markers (`>`),
    the list item it belongs to (nearest marker line of the same paragraph, above or at it),
    or its own indentation:
    - paragraph break: in a list item a new item (`- ` the same marker; `3.` after `2.`), in a
      quote `\n>\n> `, else a blank line, then the line's prefix;
    - line break: `\` at the end of the line, next line with the quote markers and the item's
      content indentation.
  - Typed text after a break is escaped as a line start; the file's text after a break (rest of
    the source line) loses its leading spaces and gets a backslash if it would start a block.
  - A break where the source line ends (before a soft line end) takes the place of that line
    end; a break at the start of a paragraph's first line or after its last text is dropped.

### Browser (`templates/docs/src/components/PageEdit.astro`, `src/scripts/page-edit.mjs`)
- Enter / Shift+Enter (keydown and beforeinput `insertParagraph` / `insertLineBreak`): in a
  text marked `b`, put 2 `<br>` (paragraph) or 1 (line; always 1 in a table cell) at the cursor;
  elsewhere the hint. The text sent reads each `<br>` as U+2028 (`pieceText`).
- A click in edit mode on a table cell, paragraph, list item or heading but not on its text puts
  the cursor in the nearest editable text of that block (end or start, by where the click was).
- Styles: no outline on hover or focus of editable text (also the browser's own focus ring),
  `cursor: text` on it and on table cells; buttons keep their keyboard focus ring.
- Hint text: "New lines can't go in a title, a heading, bold or italic text, a link or code"
  (EN / FR).

## Tests to add or update (`tests/test-page-edit.mjs`)
- `editableProps`: `b` for text in `p` / `li` / `td`, none for bold / code / heading text.
- `applyEdits` with breaks: paragraph break in a paragraph, a quote, a list item (bullet and
  numbered), a line break (`\` + indentation), cell `<br />`, typed `# x` after a break escaped,
  following `- x` escaped, a break at a source line end, at the start / end dropped, breaks in a
  range without `b` -> spaces.
- Browser helpers: `pieceText`-like reading is in the component (template check); `collectEdits`
  keeps U+2028.
- Template: no `outline: 2px solid` / dashed hover rule on editable text; `outline: none` on
  focus; Enter handling present.

## Acceptance checks
- [ ] `node --test tests/*.mjs` passes
- [ ] Playground, headless Chromium: Enter splits a paragraph and a list item, Shift+Enter makes
      a line break, a cell gets a new line; saved files hold the expected Markdown; a click in
      the empty part of a table cell puts the cursor in it; no outline while editing (screenshot)
- [ ] The old 19 browser checks still pass (Enter check updated)
- [ ] Owner: on a site, Enter / Shift+Enter / a table cell, then Save

## Implementation notes
- Public repo: no project names, addresses or host names in kit files or this spec.
