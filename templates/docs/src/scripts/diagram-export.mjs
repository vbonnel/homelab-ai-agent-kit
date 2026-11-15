// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// A diagram of the page as an SVG file that stands on its own, for the viewer's "Copy SVG" and
// "Save SVG" buttons (scripts/diagram-zoom.mjs): pasted into Figma or Penpot, or imported there.
// On the page, the diagrams take their colours from the site's CSS (src/diagrams/theme.css, the
// var(--...) in pele's SVG), which design tools can't read. So the colours, line styles, fonts and
// corner radii the browser shows are written into the copy, with the diagram's background
// behind it: what you see (light or dark theme) is what you get.
// The sums are kept apart from the browser part so the agent kit's tests can check them.

// What is written into the SVG. Inherited: a child gets its parent's value unless it has its own.
export const INHERITED = {
  fill: '#000000',
  'fill-opacity': '1',
  'fill-rule': 'nonzero',
  stroke: 'none',
  'stroke-width': '1',
  'stroke-opacity': '1',
  'stroke-dasharray': 'none',
  'stroke-dashoffset': '0',
  'stroke-linecap': 'butt',
  'stroke-linejoin': 'miter',
  'stroke-miterlimit': '4',
  'font-family': '',
  'font-size': '',
  'font-weight': '400',
  'font-style': 'normal',
  'text-anchor': 'start',
  'dominant-baseline': 'auto',
};
const OWN = ['opacity', 'rx', 'ry'];
export const PAINT = [...Object.keys(INHERITED), ...OWN];
const ROUNDED = new Set(['rect', 'ellipse']);
const LENGTHS = new Set(['stroke-width', 'stroke-dashoffset', 'font-size', 'rx', 'ry']);
const SVG_NS = 'http://www.w3.org/2000/svg';

const number = (v) => (Number.isFinite(Number(v)) ? Number(v) : 1);
const short = (n) => String(Math.round(n * 1000) / 1000);
const noPx = (v) => v.replace(/(-?[\d.]+)px\b/g, '$1');

// toHex('rgb(28, 43, 66)') -> { value: '#1c2b42', alpha: 1 }; rgba: the alpha apart (design tools
// read #rrggbb best). 'none', 'url(...)' and other values are kept as they are.
export function toHex(colour) {
  const m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(String(colour).trim());
  if (!m) return { value: String(colour).trim(), alpha: 1 };
  const hex = m.slice(1, 4).map((c) => Math.min(255, Math.round(Number(c))).toString(16).padStart(2, '0')).join('');
  const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return { value: `#${hex}`, alpha: a };
}

// The values as they go into the file: colours as #rrggbb (their alpha joins fill-opacity /
// stroke-opacity), lengths without px, dashes as "3 4"
function tidy(values) {
  const out = {};
  for (const name of PAINT) {
    const v = String(values?.[name] ?? '').trim();
    out[name] = name === 'stroke-dasharray' ? noPx(v).replace(/\s*,\s*/g, ' ') : LENGTHS.has(name) ? noPx(v) : v;
  }
  for (const [paint, opacity] of [['fill', 'fill-opacity'], ['stroke', 'stroke-opacity']]) {
    const { value, alpha } = toHex(out[paint]);
    out[paint] = value;
    if (alpha !== 1 || out[opacity] !== '') out[opacity] = short(number(out[opacity] || '1') * alpha);
  }
  return out;
}

// exportAttributes(tag, own, parent) -> [[name, value], ...] to write on one element of the copy.
// own / parent: the computed values (getComputedStyle) of the element and of its parent (null for
// the <svg> itself). An inherited value is written only when it differs from what the element
// would get anyway (its parent's, or the SVG default for the root); opacity only when not 1;
// rx / ry only on rect and ellipse (corner radii).
export function exportAttributes(tag, own, parent) {
  const mine = tidy(own);
  const above = parent ? tidy(parent) : INHERITED;
  const out = [];
  for (const name of Object.keys(INHERITED)) {
    const v = mine[name];
    if (v && v !== above[name]) out.push([name, v]);
  }
  if (mine.opacity && number(mine.opacity) !== 1) out.push(['opacity', mine.opacity]);
  if (ROUNDED.has(tag)) {
    for (const name of ['rx', 'ry']) {
      const v = mine[name];
      if (v && v !== 'auto' && Number(v) !== 0) out.push([name, v]);
    }
  }
  return out;
}

const slug = (text) => String(text ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60).replace(/-+$/, '');

// svgFileName('Getting started', 2) -> 'getting-started-diagram-2.svg'
export function svgFileName(title, n) {
  const name = slug(title);
  return `${name ? `${name}-` : ''}diagram-${n}.svg`;
}

// --- In the browser ------------------------------------------------------------------
const valuesOf = (el) => {
  const style = getComputedStyle(el);
  return Object.fromEntries(PAINT.map((name) => [name, style.getPropertyValue(name)]));
};

// The page's <svg> -> the SVG text of a copy that needs no CSS: every element gets the colours,
// lines and fonts the browser shows (its style attributes, <style> elements and var(...) are
// gone), its size from the viewBox, and a rectangle in the diagram's background colour behind.
export function selfContainedSvg(svg) {
  const copy = svg.cloneNode(true);
  const from = [svg, ...svg.querySelectorAll('*')];
  const to = [copy, ...copy.querySelectorAll('*')];
  const values = new Map(from.map((el) => [el, el.namespaceURI === SVG_NS ? valuesOf(el) : null]));
  to.forEach((el, i) => {
    if (el.namespaceURI !== SVG_NS) return; // HTML labels (mermaid.js): left as they are
    el.removeAttribute('style');
    // rx / ry attributes stay (a plain number is fine): only replaced when the browser gives a value
    for (const name of PAINT) if (name !== 'rx' && name !== 'ry') el.removeAttribute(name);
    const parent = i === 0 ? null : values.get(from[i].parentElement) ?? null;
    for (const [name, value] of exportAttributes(el.localName, values.get(from[i]), parent)) el.setAttribute(name, value);
  });
  for (const style of copy.querySelectorAll('style')) style.remove();

  const box = svg.viewBox?.baseVal;
  const onPage = svg.getBoundingClientRect();
  const area = box && box.width > 0 && box.height > 0
    ? { x: box.x, y: box.y, w: box.width, h: box.height }
    : { x: 0, y: 0, w: onPage.width, h: onPage.height };
  copy.setAttribute('xmlns', SVG_NS);
  copy.setAttribute('width', short(area.w));
  copy.setAttribute('height', short(area.h));

  // The background: the diagram's card on the page, else pele's background colour
  const card = svg.closest('.kit-diagram');
  let bg = toHex(card ? getComputedStyle(card).backgroundColor : '');
  if (!bg.value.startsWith('#') || bg.alpha === 0) bg = toHex(getComputedStyle(svg).getPropertyValue('--pele-bg') || '');
  if (bg.value && bg.value !== 'transparent' && bg.alpha !== 0) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    for (const [k, v] of [['x', area.x], ['y', area.y], ['width', area.w], ['height', area.h]]) rect.setAttribute(k, short(v));
    rect.setAttribute('fill', bg.value);
    if (bg.alpha !== 1) rect.setAttribute('fill-opacity', short(bg.alpha));
    copy.prepend(rect);
  }
  return new XMLSerializer().serializeToString(copy);
}
