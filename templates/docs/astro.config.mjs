// Docs website for this project (Starlight). Created by the homelab agent kit.
// Pages live in src/content/docs/. Rebuilt automatically after each merge.
// Diagrams: write ```mermaid code blocks in the pages; they follow the light/dark theme.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
  telemetry: false,
  integrations: [
    mermaid({ theme: 'default', autoTheme: true, enableLog: false }), // must come before starlight
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
