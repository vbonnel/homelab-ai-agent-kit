// Docs website for this project (Starlight). Created by the homelab agent kit.
// Pages live in src/content/docs/. Rebuilt automatically after each merge.
// Diagrams: write ```mermaid code blocks in the pages. They are drawn when the website is built,
// in colours that follow the light/dark theme; a diagram with an error stops the build.
// Kinds of boxes (:::data, :::external...): see src/diagrams/theme.css.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import diagrams from './src/diagrams/diagrams.mjs';

export default defineConfig({
  telemetry: false,
  integrations: [
    diagrams(), // ```mermaid blocks drawn by pele (src/diagrams/); before starlight
    starlight({
      title: '__PROJECT_TITLE__',
      // Kit docs features (kit docs upgrade): the docs version next to the title, and an
      // "Enlarge" button on each diagram (zoom and move it full screen)
      components: {
        SiteTitle: './src/components/SiteTitle.astro',
        MarkdownContent: './src/components/MarkdownContent.astro',
      },
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
