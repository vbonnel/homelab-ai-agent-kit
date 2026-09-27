// Docs website for this project (Starlight). Created by the homelab agent kit.
// Pages live in src/content/docs/. Rebuilt automatically after each merge.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  telemetry: false,
  integrations: [
    starlight({
      title: '__PROJECT_TITLE__',
      sidebar: [
        { label: 'Context', link: '/' },
        { label: 'Getting started', link: '/getting-started/' },
        { label: 'Tech stack & how it works', link: '/how-it-works/' },
        { label: 'Operations & maintenance', link: '/operations/' },
        { label: 'Changelog', link: '/changelog/' },
      ],
    }),
  ],
});
