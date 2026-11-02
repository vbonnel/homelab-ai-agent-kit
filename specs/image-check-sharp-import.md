# Docs picture check: works with Astro 5 too

Status: ready to merge
Size: small
Database change: no
New settings (.env keys): none
Restart needed after merge: no (projects get it with `kit update`, then `kit docs upgrade` through `/feature`)

## Goal
On a docs website still on Astro 5, the build stopped with "Vite module runner has been closed" in
the kit's picture check (`images()`): `check.mjs` loaded sharp with `await import('sharp')` while
the build was already running, after Astro 5 had closed the loader of `astro.config.mjs`. Astro 7
sites were not affected.

## Changes
- `templates/docs/src/image-tools/check.mjs`: `import sharp from 'sharp'` at the top (loaded with
  the config), no dynamic import.

## Tests to add or update
- `tests/test-docs-features.mjs`: check.mjs and optimize.mjs import sharp at the top, never with
  `import('sharp')`.

## Acceptance checks
- [x] An Astro 5 site (Starlight 0.37) and an Astro 7 site build with `images()`; a too-big picture
      still stops the Astro 7 build
- [x] `scripts/test.sh` passes
