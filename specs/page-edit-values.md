# Docs page editing: a project's own values (DOCS_EDIT_VALUES)

Status: building
Size: normal
Database change: no
New settings (.env keys): none. New project setting in `.agentkit`: `DOCS_EDIT_VALUES=<module path>`.
Restart needed after merge: the docs website service (new server code); sites take the browser
part with `kit docs upgrade`.

## Goal
A project whose pages are mostly made by its own components (values read from its data files,
not written in the page's Markdown) wants all that text editable with the same Edit button and
Save. The kit gives the hook; the project says which values can change and writes them.

## Not doing
- The kit knows nothing about the project's data: no file formats, no parsing of values.
- No git versions for values (the project decides how it keeps their history).
- No new values or rows (only text that is shown can be changed).

## Changes
- `templates/docs/src/components/PageEdit.astro`: elements with `data-kit-value="<id>"` inside the
  page content are editable like the page's text (same Enter rules: new lines only with kind `b`;
  same cursor, no outline, click near). Save sends `values: [{ id, before, after }]` next to `edits`
  (only when there are some). A refused value shows the server's message in the bar.
- `templates/docs/src/scripts/page-edit.mjs`: `collectValues`, error `value` (EN / FR) with the
  server's reason.
- `lib/docs-edit.mjs`: `editSettings` reads `DOCS_EDIT_VALUES`; `pageInfo` lists the page's
  `data-kit-value` ids; `checkValues` (only those ids, once each, strings, sizes). A save with
  values: the module (a file inside the project, loaded fresh) `saveValues({ root, page, values })`
  -> `{ count, restore }` or `{ error: 'value' | 'changed', message }`; refused -> nothing written,
  no build. Then the page's own edits (if any), one build; a failed build puts the page back and
  calls `restore()`. Git: only the page file (when it changed). Answer `{ ok, version, values }`.
  A save with no change at all: `{ ok, unchanged }` (was "No changes were sent").
- `README.md`: the setting and the module's contract.

## Tests (`tests/test-page-edit.mjs`)
- settings, `pageInfo` values, `checkValues`; browser helpers `collectValues`, `errorMessage('value')`.
- server: values saved by a test module (no git version, one build), refused by the module (its
  message, nothing written, no build), stale value -> 409, id not on the page, failed build ->
  restore; values + page text in one save (only the page in git); no setting / a module outside
  the project -> refused.

## Acceptance checks
- [x] `node --test tests/*.mjs` passes (85 tests)
- [ ] With a real project's components (its work copy, sample data): values edited in a browser and
      saved, then shown after the reload

## Implementation notes
- Public repo: no project names, addresses or host names in kit files or this spec.
