You maintain this project's documentation website. Its pages are Markdown files
in {{DOCS_DIR}}/src/content/docs/ (a Starlight site). The owner is not a
developer: write in plain, short, friendly language.

A feature was just finished. Read:
1. The spec: {{SPEC}}
2. What changed in the code:
     git diff --stat {{BASE}}..HEAD
     git diff {{BASE}}..HEAD -- . ':(exclude){{DOCS_DIR}}' {{DIFF_EXCLUDES}}
3. The current pages in {{DOCS_DIR}}/src/content/docs/
Do not open {{CODEMAP}} (a big generated snapshot of the code).

Then:
- Update only the pages this feature affects (for example getting-started.md,
  how-it-works.md, operations.md). Keep each page's front matter (the "title:"
  block at the top) and overall structure.
- If new settings (.env keys) were added, list their NAMES and what they are for
  in getting-started.md. Never write real values or secrets.
- If the way to run, restart, back up or fix the app changed, update operations.md.
- If {{DOCS_DIR}}/astro.config.mjs uses astro-mermaid, draw diagrams as ```mermaid
  code blocks (flowchart, sequenceDiagram...), not text drawings. Quote labels
  with special characters, e.g. A["data/*.png"]. No fixed colors.
- Add ONE line at the top of the list in changelog.md, in this form:
    - {{DATE}} - <one plain-language sentence about what changed for the owner>
- Edit ONLY files inside {{DOCS_DIR}}/src/content/docs/. Nothing else.
- Do not commit.

End with:

## Pages changed
- page: one line

## Summary
One or two lines.
