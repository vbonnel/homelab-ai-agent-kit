// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Full-screen viewer for the Mermaid diagrams. Each diagram gets an "Enlarge" button (and
// opens when clicked): a <dialog> where it can be zoomed (wheel, pinch, + -, double click)
// and moved (drag). Loaded on every page by components/MarkdownContent.astro; pages
// without diagrams: nothing happens.
// Diagrams drawn when the website is built (src/diagrams/, pele) are an <svg> inside
// <div class="kit-diagram">. Sites still on astro-mermaid: it draws each diagram as an <svg>
// inside <pre class="mermaid">, then sets data-processed; a theme change draws it again (new
// innerHTML), so the button sits outside the diagram's element.
import { fitView, zoomAt, zoomLimits } from './zoom-math.mjs';

const STEP = 1.25; // one press of + or -, or a key
const HINT = 'Scroll or pinch to zoom, drag to move, Esc to close';
const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

let dialog, stage, layer, level;
let view = { scale: 1, x: 0, y: 0 };
let limits = { min: 0.5, max: 4 };
let size = { w: 0, h: 0 };   // the diagram's own size
let room = { w: 0, h: 0 };   // the viewer's size
const pointers = new Map();  // fingers or mouse buttons down: id -> { x, y }
let gesture = null;          // where they were at the last move

// Diagrams drawn when the website was built have their picture at once; diagrams drawn in the
// browser (astro-mermaid) once it sets data-processed
const DIAGRAMS = 'div.kit-diagram, pre.mermaid';
const drawn = (diagram) => (diagram.matches('pre.mermaid') && !diagram.hasAttribute('data-processed')
  ? null : diagram.querySelector(':scope > svg'));

// --- On the page: a wrapper and a button for each diagram ---------------------------
function setup() {
  for (const diagram of document.querySelectorAll(DIAGRAMS)) {
    if (diagram.parentElement?.classList.contains('diagram-zoom')) continue;
    const wrap = document.createElement('div');
    wrap.className = 'diagram-zoom';
    diagram.before(wrap);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'diagram-zoom-open';
    button.title = 'Open the diagram full screen to zoom';
    button.innerHTML = `${ICON}<span>Enlarge</span>`;
    button.addEventListener('click', () => open(diagram));
    wrap.append(button, diagram);
    // Clicking the diagram opens it too, unless some of its text was just selected
    diagram.addEventListener('click', () => {
      if (window.getSelection()?.isCollapsed !== false) open(diagram);
    });
  }
}

// --- The viewer: made once, on the first open ---------------------------------------
function tool(label, text, action) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = text;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.addEventListener('click', action);
  return b;
}

function makeViewer() {
  dialog = document.createElement('dialog');
  dialog.className = 'diagram-zoom-viewer';
  dialog.setAttribute('aria-label', 'Diagram, full screen');
  const bar = document.createElement('div');
  bar.className = 'diagram-zoom-bar';
  const hint = document.createElement('span');
  hint.className = 'diagram-zoom-hint';
  hint.textContent = HINT;
  level = document.createElement('span');
  level.className = 'diagram-zoom-level';
  level.setAttribute('aria-live', 'polite');
  bar.append(
    hint, level,
    tool('Zoom out (-)', '−', () => zoomCentre(1 / STEP)),
    tool('Zoom in (+)', '+', () => zoomCentre(STEP)),
    tool('Show the whole diagram (0)', 'Fit', fit),
    tool('Close (Esc)', '✕', () => dialog.close()),
  );
  stage = document.createElement('div');
  stage.className = 'diagram-zoom-stage';
  layer = document.createElement('div');
  layer.className = 'diagram-zoom-layer';
  stage.append(layer);
  dialog.append(bar, stage);
  document.body.append(dialog);

  // Mouse wheel and trackpad pinch (the browser sends it as a wheel with Ctrl): zoom there
  dialog.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (!stage.contains(e.target)) return;
    const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * room.h : e.deltaY;
    const factor = Math.min(Math.max(Math.exp(-px * (e.ctrlKey ? 0.01 : 0.002)), 0.5), 2);
    show(zoomAt(view, factor, at(e), limits));
  }, { passive: false });

  // One finger or the mouse: move. Two fingers: pinch to zoom, and move
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, at(e));
    gesture = measure();
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, at(e));
    const now = measure();
    if (gesture && now.count === gesture.count) {
      let next = { ...view, x: view.x + now.x - gesture.x, y: view.y + now.y - gesture.y };
      if (now.count > 1 && gesture.dist > 0) next = zoomAt(next, now.dist / gesture.dist, now, limits);
      show(next);
    }
    gesture = now;
  });
  const lift = (e) => {
    pointers.delete(e.pointerId);
    gesture = measure();
    if (pointers.size === 0) stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', lift);
  stage.addEventListener('pointercancel', lift);
  stage.addEventListener('dblclick', (e) => show(zoomAt(view, 2, at(e), limits)));

  // Keys: + - zoom, 0 fit, arrows move. Esc is handled by the <dialog> itself
  dialog.addEventListener('keydown', (e) => {
    const move = { ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[e.key];
    if (e.key === '+' || e.key === '=') zoomCentre(STEP);
    else if (e.key === '-' || e.key === '_') zoomCentre(1 / STEP);
    else if (e.key === '0') fit();
    else if (move) show({ ...view, x: view.x + move[0] * room.w * 0.1, y: view.y + move[1] * room.h * 0.1 });
    else return;
    e.preventDefault();
  });

  dialog.addEventListener('close', () => {
    layer.replaceChildren();
    pointers.clear();
    gesture = null;
    stage.classList.remove('dragging');
  });

  // A new window size keeps the same part of the diagram in the middle
  window.addEventListener('resize', () => {
    if (!dialog.open) return;
    const before = room;
    measureRoom();
    limits = zoomLimits(fitView(size, room));
    show({ ...view, x: view.x + (room.w - before.w) / 2, y: view.y + (room.h - before.h) / 2 });
  });
}

// --- Open, fit, zoom, draw -----------------------------------------------------------
function open(diagram) {
  const svg = drawn(diagram);
  if (!svg) return; // not drawn yet, or a diagram with an error
  if (!dialog) makeViewer();
  // A copy with its own ids, so nothing clashes with the diagram on the page (arrow heads
  // and styles point to the ids). It is our own diagram, drawn from our own pages.
  const id = svg.id;
  layer.innerHTML = id && id.length >= 8 ? svg.outerHTML.split(id).join(`${id}-zoom`) : svg.outerHTML;
  const copy = layer.firstElementChild;
  const box = copy.viewBox?.baseVal;
  const onPage = svg.getBoundingClientRect();
  size = box && box.width > 0 && box.height > 0
    ? { w: box.width, h: box.height }
    : { w: onPage.width, h: onPage.height };
  copy.setAttribute('width', String(size.w));
  copy.setAttribute('height', String(size.h));
  copy.style.maxWidth = 'none';
  dialog.showModal();
  fit();
}

function measureRoom() {
  room = { w: stage.clientWidth, h: stage.clientHeight };
}

function fit() {
  measureRoom();
  const whole = fitView(size, room);
  limits = zoomLimits(whole);
  show(whole);
}

function zoomCentre(factor) {
  show(zoomAt(view, factor, { x: room.w / 2, y: room.h / 2 }, limits));
}

function show(next) {
  view = next;
  layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
  level.textContent = `${Math.round(view.scale * 100)}%`;
}

// Pointer position inside the viewer
function at(e) {
  const r = stage.getBoundingClientRect();
  return { x: e.clientX - r.left, y: e.clientY - r.top };
}

// Centre of the fingers down, how many, and how far apart the first two are
function measure() {
  const p = [...pointers.values()];
  if (p.length === 0) return null;
  const two = p.slice(0, 2);
  const x = two.reduce((s, q) => s + q.x, 0) / two.length;
  const y = two.reduce((s, q) => s + q.y, 0) / two.length;
  const dist = two.length > 1 ? Math.hypot(two[0].x - two[1].x, two[0].y - two[1].y) : 0;
  return { count: two.length, x, y, dist };
}

setup();
