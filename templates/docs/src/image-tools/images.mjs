// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Pictures of the docs website (Astro integration, set in astro.config.mjs: `images()` in
// `integrations`):
// - every picture is built in a few widths (srcset + sizes), never wider than its original, so
//   each screen downloads the size it needs (WebP and lazy loading are Astro's defaults). A
//   project that sets its own `image: { layout }` in astro.config.mjs keeps it.
// - each build checks the original pictures (check.mjs): one that is too big stops the build
//   with the fix to run (`npm run images`), so `kit merge` never puts a heavy picture online.
import { fileURLToPath } from 'node:url';
import { BREAKPOINTS } from './rules.mjs';
import { checkPictures } from './check.mjs';

export default function images() {
  return {
    name: 'kit-images',
    hooks: {
      'astro:config:setup': async ({ config, command, updateConfig, logger }) => {
        if (!config.image?.layout) {
          updateConfig({ image: { layout: 'constrained', ...(config.image?.breakpoints ? {} : { breakpoints: BREAKPOINTS }) } });
        }
        if (command !== 'build') return;
        const { errors, warnings } = await checkPictures(fileURLToPath(config.root));
        for (const w of warnings) logger.warn(w);
        if (errors.length) {
          throw new Error(`Pictures too big for the docs website:\n${errors.map((e) => `  - ${e}`).join('\n')}\n`
            + 'Fix: in the docs website folder run `npm run images`, then build again.');
        }
      },
    },
  };
}
