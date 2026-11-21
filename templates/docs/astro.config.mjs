// Docs website for this project (Starlight). Created by the homelab agent kit.
// Pages live in src/content/docs/. Rebuilt automatically after each merge.
// Diagrams: write ```mermaid code blocks in the pages. They are drawn when the website is built,
// in colours that follow the light/dark theme; a diagram with an error stops the build.
// Kinds of boxes (:::data, :::external...): see src/diagrams/theme.css.
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import diagrams from './src/diagrams/diagrams.mjs';
import images from './src/image-tools/images.mjs';
import pageEdit from './src/page-edit/page-edit.mjs';

export default defineConfig({
  telemetry: false,
  integrations: [
    diagrams(), // ```mermaid blocks drawn by pele (src/diagrams/); before starlight
    images(), // pictures: a few widths each; a too-big original stops the build (npm run images fixes it)
    pageEdit(), // page text editable in the browser (Edit button, only when the docs server allows it: kit docs edit on)
    starlight({
      title: '__PROJECT_TITLE__',
      // Kit docs features (kit docs upgrade): the docs version next to the title, a full-screen
      // viewer (click a diagram or a picture to zoom and move it; copy or save a diagram as SVG),
      // page actions next to the page title (copy as Markdown, print), an Export button (the whole
      // docs as one Markdown file), the "On this page" style and a light / dark button
      components: {
        SocialIcons: './src/components/SocialIcons.astro',
        PageTitle: './src/components/PageTitle.astro',
        TableOfContents: './src/components/TableOfContents.astro',
        ThemeSelect: './src/components/ThemeSelect.astro',
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
