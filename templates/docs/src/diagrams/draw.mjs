// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// The ```mermaid code blocks of a page become their pictures (SVG) when the website is built.
// diagrams.mjs calls these with pele's render(); kept apart from pele and Astro so they can be
// tested without them (the agent kit's tests/test-docs-features.mjs).

// One ```mermaid block (an mdast `code` node: value, position) -> the HTML that replaces it: the
// drawn diagram in a <div class="kit-diagram">. `count` numbers the diagrams of the page (their
// ids stay unique). draw(source, { idPrefix }) -> { svg, type }, or throws an error that may say
// where in the diagram ({ line, column }). A diagram that can't be drawn stops the build: the
// error gives the page, the line in the page and what is wrong. skipped() -> how many lines of
// the file come before the text the positions count from (the frontmatter, for Astro 7).
export function drawCode(node, count, page, draw, skipped = () => 0) {
  let drawn;
  try {
    drawn = draw(node.value, { idPrefix: `kit-diagram-${count}-` });
  } catch (error) {
    throw diagramError(error, node, page, skipped());
  }
  const type = String(drawn.type || 'diagram').replace(/[^\w-]/g, '');
  return `<div class="kit-diagram" data-diagram="${type}">${drawn.svg}</div>`;
}

// The same for a whole page (an mdast tree, as remark plugins get it): each ```mermaid block
// becomes an `html` node. Returns how many diagrams were drawn.
export function drawDiagrams(tree, page, draw, skipped) {
  let count = 0;
  const visit = (node) => {
    if (isDiagram(node)) {
      const value = drawCode(node, ++count, page, draw, skipped);
      for (const key of Object.keys(node)) if (key !== 'position') delete node[key];
      Object.assign(node, { type: 'html', value });
      return;
    }
    node.children?.forEach(visit);
  };
  visit(tree);
  return count;
}

export const isDiagram = (node) => node?.type === 'code' && node.lang === 'mermaid';

// "Diagram error in src/content/docs/x.md, line 12 (line 3 of the diagram): <what is wrong>".
// The diagram starts on the line after the ```mermaid line.
export function diagramError(error, node, page, skipped = 0) {
  const fence = node.position?.start?.line && node.position.start.line + skipped;
  const inside = error?.line > 0 ? error.line : 0;
  let where = '';
  if (fence && inside) where = `, line ${fence + inside} (line ${inside} of the diagram)`;
  else if (fence) where = `, in the diagram that starts at line ${fence + 1}`;
  const what = String(error?.message ?? error).trim();
  const result = new Error(`Diagram error in ${page}${where}: ${what}`, { cause: error });
  result.name = 'DiagramError';
  return result;
}

// How many lines of a file come before `body` (the page as Markdown sees it: the file without its
// frontmatter, trimmed); 0 when the file doesn't hold it.
export function linesBefore(text, body) {
  if (typeof text !== 'string' || typeof body !== 'string' || !body) return 0;
  const at = text.lastIndexOf(body);
  return at < 0 ? 0 : text.slice(0, at).split('\n').length - 1;
}
