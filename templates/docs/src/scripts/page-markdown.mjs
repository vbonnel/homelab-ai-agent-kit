// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// The Markdown version of a docs page, made at build time by src/pages/[...slug].md.ts and
// used by the page actions (components/PageActions.astro): "Copy page" copies it, Claude /
// ChatGPT are given its public address. Made for AI tools: the title and description on top,
// then the page's text without pictures (their relative paths mean nothing outside the site)
// and comments. Kept apart so the agent kit's tests can check it without Astro.

// pageMarkdown({ title, description, body }) -> the page as Markdown text
export function pageMarkdown({ title, description, body }) {
  const text = (body ?? '')
    .replace(/<!--[\s\S]*?-->/g, '') // HTML comments
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '') // MDX comments
    .replace(/^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*\r?\n?/gm, '') // lines holding only a picture
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // pictures inside a line
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return `# ${title}\n\n${description ? `> ${description}\n\n` : ''}${text}\n`;
}
