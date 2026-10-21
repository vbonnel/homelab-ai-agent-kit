// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Mermaid diagrams drawn by pele (https://pele.run) when the website is built: each ```mermaid
// code block of a page becomes a finished picture (SVG), so no diagram code runs in the browser
// and pages show their diagrams at once. Colours come from theme.css and follow the site's
// light/dark switch without a redraw. A diagram with an error stops the build (the message gives
// the page and the line), so `kit merge` never puts a broken diagram online.
// Set in astro.config.mjs: `diagrams()` in `integrations`.
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { render } from 'pele';
import { drawCode, drawDiagrams, isDiagram, linesBefore } from './draw.mjs';

// Text sizes are measured at build time with Helvetica/Arial widths, so the diagrams use those
// fonts (theme.css sets the same list): labels always fit in their boxes.
const OPTIONS = { fontFamily: 'Helvetica, Arial, "Liberation Sans", Arimo, sans-serif', fontSize: 14 };
const draw = (source, options) => render(source, { ...OPTIONS, ...options });
const pagePath = (file) => (file ? relative(process.cwd(), file) : 'a page');
// For error messages: the lines of the file before the text Markdown got (its frontmatter)
const skippedLines = (file, body) => () => {
  try {
    return linesBefore(readFileSync(file, 'utf8'), body);
  } catch {
    return 0;
  }
};

// Astro 7's Markdown (Sätteri): made for each page, so the diagrams of a page are numbered 1, 2...
function satteriDiagrams(page) {
  let count = 0;
  const file = page.fileURL && fileURLToPath(page.fileURL);
  const skipped = skippedLines(file, page.source);
  return {
    name: 'kit-diagrams',
    options: { position: true },
    code(node) {
      if (isDiagram(node)) return { type: 'html', value: drawCode(node, ++count, pagePath(file), draw, skipped) };
    },
  };
}

// Older Astro (remark)
function remarkDiagrams() {
  return (tree, file) => {
    drawDiagrams(tree, pagePath(file.path), draw, skippedLines(file.path, String(file.value)));
  };
}

export default function diagrams() {
  return {
    name: 'kit-diagrams',
    hooks: {
      'astro:config:setup': ({ config, updateConfig, injectScript }) => {
        // Sätteri's options are made to be added to by integrations
        const plugins = config.markdown?.processor?.name === 'satteri' && config.markdown.processor.options?.mdastPlugins;
        if (Array.isArray(plugins)) plugins.push(satteriDiagrams);
        else updateConfig({ markdown: { remarkPlugins: [remarkDiagrams] } });
        // The colours, on every page
        injectScript('page-ssr', `import ${JSON.stringify(fileURLToPath(new URL('./theme.css', import.meta.url)))};`);
      },
    },
  };
}
