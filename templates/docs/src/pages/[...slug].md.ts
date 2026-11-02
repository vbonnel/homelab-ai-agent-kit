/**
 * agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
 * delete this line to keep your own version instead.
 *
 * A Markdown version of each docs page, next to it: /getting-started/ -> /getting-started.md,
 * the root page -> /index.md
 * (the site's base path included). Used by the page actions on the right of the page titles
 * (src/components/PageActions.astro). Text cleaning: src/scripts/page-markdown.mjs.
 */
import type { APIRoute, GetStaticPaths } from 'astro';
import { getCollection } from 'astro:content';
import { pageMarkdown } from '../scripts/page-markdown.mjs';

export const getStaticPaths = (async () => {
	const pages = await getCollection('docs');
	return pages.map((entry) => ({
		params: { slug: entry.id || 'index' }, // the root page has an empty id
		props: { title: entry.data.title, description: entry.data.description, body: entry.body },
	}));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
	new Response(pageMarkdown(props as { title: string; description?: string; body?: string }), {
		headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
	});
