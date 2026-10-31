// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Full-screen viewer for the Mermaid diagrams and the pictures in the pages. Each diagram gets
// an "Enlarge" button (and opens when clicked); a picture opens when clicked (or Enter / Space
// when it has the keyboard focus). The viewer is a <dialog> where it can be zoomed (wheel,
// pinch, + -, double click) and moved (drag); a click (not a drag) closes it. Loaded on every page by
// components/MarkdownContent.astro; pages without diagrams or pictures: nothing happens.
// Diagrams drawn when the website is built (src/diagrams/, pele) are an <svg> inside
// <div class="kit-diagram">. Sites still on astro-mermaid: it draws each diagram as an <svg>
// inside <pre class="mermaid">, then sets data-processed; a theme change draws it again (new
// innerHTML), so the button sits outside the diagram's element.
// Pictures: the <img> of the page content (Astro's .webp). A copy is shown at most at its own
// size when fitted (no blurry blow-up), and can still be zoomed in.
import { fitView, isDoubleClick, zoomAt, zoomLimits } from './zoom-math.mjs';

const STEP = 1.25; // one press of + or -, or a key
const HINT = 'Scroll or pinch to zoom, drag to move, click or Esc to close';
const CLICK_MOVE = 6;   // pixels a click may move and still be a click (more: a drag)
const DOUBLE_TIME = 300; // milliseconds: a single click closes after this, unless a second one comes
const ICON = '<svg aria-hidden="true" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';

let dialog, stage, layer, level, fitButton;
let view = { scale: 1, x: 0, y: 0 };
let limits = { min: 0.5, max: 4 };
let size = { w: 0, h: 0 };   // the diagram's or picture's own size
let most = Infinity;         // largest fitted scale: 1 for pictures
let room = { w: 0, h: 0 };   // the viewer's size
const pointers = new Map();  // fingers or mouse buttons down: id -> { x, y }
let gesture = null;          // where they were at the last move
let press = null;            // the press in progress: where it started, moved, several fingers
let lastClick = null;        // the click before, for double clicks: { x, y, t }
let closeTimer = 0;

// Diagrams drawn when the website was built have their picture at once; diagrams drawn in the
// browser (astro-mermaid) once it sets data-processed
const DIAGRAMS = 'div.kit-diagram, pre.mermaid';
const drawn = (diagram) => (diagram.matches('pre.mermaid') && !diagram.hasAttribute('data-processed')
  ? null : diagram.querySelector(':scope > svg'));

// Pictures in the page content. Left alone: pictures in a link or a button (the click keeps its
// job), a diagram's own, pictures handled by the starlight-image-zoom add-on (a site that still
// uses it), pictures marked data-zoom="off", data-zoom-off (the add-on's mark) or class no-zoom
// (on the picture or around it), and icons (48 x 48 pixels or less).
const PICTURES = '.sl-markdown-content img';
const LEFT_ALONE = 'a, button, .kit-diagram, pre.mermaid, starlight-image-zoom-zoomable, '
  + '[data-zoom="off"], [data-zoom-off], .no-zoom';
const ICON_PIXELS = 48;
const big = (img) => img.naturalWidth > ICON_PIXELS || img.naturalHeight > ICON_PIXELS; // 0 x 0: not loaded or broken

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
  for (const img of document.querySelectorAll(PICTURES)) {
    if (img.classList.contains('image-zoom') || img.closest(LEFT_ALONE)) continue;
    // Pictures loaded later (lazy, further down the page) are checked when they arrive
    if (img.complete) { if (big(img)) zoomable(img); }
    else img.addEventListener('load', () => { if (big(img)) zoomable(img); }, { once: true });
  }
}

// The picture itself is the button: zoom-in pointer, Tab reaches it, click / Enter / Space open it
function zoomable(img) {
  img.classList.add('image-zoom');
  img.tabIndex = 0;
  if (!img.title) img.title = 'Click to enlarge';
  img.addEventListener('click', () => open(img));
  img.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    open(img);
  });
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
    fitButton = tool('Show the whole diagram (0)', 'Fit', fit),
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
    if (pointers.size === 0) press = { ...at(e), moved: false, several: false };
    else if (press) press.several = true;
    pointers.set(e.pointerId, at(e));
    gesture = measure();
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const p = at(e);
    if (press && Math.hypot(p.x - press.x, p.y - press.y) > CLICK_MOVE) press.moved = true;
    pointers.set(e.pointerId, p);
    const now = measure();
    if (gesture && now.count === gesture.count) {
      let next = { ...view, x: view.x + now.x - gesture.x, y: view.y + now.y - gesture.y };
      if (now.count > 1 && gesture.dist > 0) next = zoomAt(next, now.dist / gesture.dist, now, limits);
      show(next);
    }
    gesture = now;
  });
  const lift = (e, cancelled) => {
    if (!pointers.delete(e.pointerId)) return;
    gesture = measure();
    if (pointers.size > 0) return;
    stage.classList.remove('dragging');
    const clicked = press && !cancelled && !press.moved && !press.several;
    press = null;
    if (clicked) click(at(e));
  };
  stage.addEventListener('pointerup', (e) => lift(e, false));
  stage.addEventListener('pointercancel', (e) => lift(e, true));

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
    press = null;
    lastClick = null;
    clearTimeout(closeTimer);
    stage.classList.remove('dragging');
  });

  // A new window size keeps the same part of the diagram in the middle
  window.addEventListener('resize', () => {
    if (!dialog.open) return;
    const before = room;
    measureRoom();
    limits = zoomLimits(fitView(size, room, 24, most));
    show({ ...view, x: view.x + (room.w - before.w) / 2, y: view.y + (room.h - before.h) / 2 });
  });
}

// --- Open, fit, zoom, draw -----------------------------------------------------------
function open(item) {
  if (item.tagName === 'IMG') openPicture(item);
  else openDiagram(item);
}

function openDiagram(diagram) {
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
  showViewer('Diagram, full screen', 'Show the whole diagram (0)', Infinity);
}

function openPicture(img) {
  if (!img.naturalWidth || !img.naturalHeight) return; // not loaded, or broken
  if (!dialog) makeViewer();
  // The same file as on the page (currentSrc: the size the browser picked), at its own size
  const copy = document.createElement('img');
  copy.src = img.currentSrc || img.src;
  copy.alt = img.alt;
  copy.draggable = false;
  size = { w: img.naturalWidth, h: img.naturalHeight };
  copy.width = size.w;
  copy.height = size.h;
  copy.style.width = `${size.w}px`;
  copy.style.height = `${size.h}px`;
  copy.style.maxWidth = 'none';
  layer.replaceChildren(copy);
  showViewer('Picture, full screen', 'Show the whole picture (0)', 1);
}

// Open the viewer, its labels saying what it shows; closing gives the keyboard focus back to
// what opened it (the <dialog> does that by itself)
function showViewer(label, fitLabel, largest) {
  dialog.setAttribute('aria-label', label);
  fitButton.title = fitLabel;
  fitButton.setAttribute('aria-label', fitLabel);
  most = largest;
  dialog.showModal();
  fit();
}

function measureRoom() {
  room = { w: stage.clientWidth, h: stage.clientHeight };
}

function fit() {
  measureRoom();
  const whole = fitView(size, room, 24, most);
  limits = zoomLimits(whole);
  show(whole);
}

// A click (or tap) that did not move: double click zooms in there, a single one closes the
// viewer (a moment later, so a double click can still come)
function click(p) {
  const now = { ...p, t: performance.now() };
  clearTimeout(closeTimer);
  if (isDoubleClick(lastClick, now, DOUBLE_TIME)) {
    lastClick = null;
    show(zoomAt(view, 2, p, limits));
  } else {
    lastClick = now;
    closeTimer = setTimeout(() => dialog.close(), DOUBLE_TIME);
  }
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
