// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Sums for the diagram viewer (diagram-zoom.mjs), kept apart so they can be tested without a
// browser (the agent kit's tests/test-docs-features.mjs). A view is { scale, x, y }: the diagram is drawn
// `scale` times its own size, its top left corner at (x, y) in the viewer, in pixels.

// The view that shows the whole diagram, centred, `pad` pixels from the viewer's edges.
// content and stage: { w, h }. Sizes of 0 (not drawn yet) give scale 1.
export function fitView(content, stage, pad = 24) {
  const room = { w: Math.max(stage.w - 2 * pad, 1), h: Math.max(stage.h - 2 * pad, 1) };
  const scale = content.w > 0 && content.h > 0 ? Math.min(room.w / content.w, room.h / content.h) : 1;
  return { scale, x: (stage.w - content.w * scale) / 2, y: (stage.h - content.h * scale) / 2 };
}

// How far the viewer may zoom out and in: from half the fitted size to 10 times it
// (and at least to 4 times the diagram's own size, so small text gets readable).
export function zoomLimits(fit) {
  return { min: fit.scale / 2, max: Math.max(fit.scale * 10, 4) };
}

// Zoom by `factor` (2 = twice as big) keeping `point` ({ x, y } in the viewer) in place,
// the scale kept within limits ({ min, max }).
export function zoomAt(view, factor, point, limits) {
  const scale = Math.min(Math.max(view.scale * factor, limits.min), limits.max);
  const k = scale / view.scale;
  return { scale, x: point.x - (point.x - view.x) * k, y: point.y - (point.y - view.y) * k };
}
