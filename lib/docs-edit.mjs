// Saving a docs page changed in the browser (the Edit button of the docs template,
// templates/docs/src/components/PageEdit.astro). docs-serve.mjs sends /_kit/edit here:
//   GET  /_kit/edit -> { "enabled": true | false }
//   POST /_kit/edit  { page, edits: [{ s, e, before, after }] } -> the changed words written into
//        the page's Markdown file, the website rebuilt (kit docs build), the file saved in git.
// Editing is on when the project's .agentkit says DOCS_EDIT=on (`kit docs edit on`), read on each
// request. No password: anyone who can open the website can save. Other websites can't save
// through a visitor's browser: the request needs the X-Kit-Edit header and a JSON body (a page of
// another address can't send them here), Origin and Host must match, and Host must be an IP
// address, localhost or a name listed in DOCS_EDIT_HOSTS (no DNS rebinding). What may change
// comes from the built page in dist/, never from the browser, and typed text is always written
// as text (templates/docs/src/page-edit/markdown-text.mjs). A save that renames a heading also
// updates the links to its section in the site's other pages (docs-links.mjs), or is refused.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyEdits } from '../templates/docs/src/page-edit/markdown-text.mjs';
import { brokenLinks, decodeHtml, pageUrl, renamedSections, rewriteSectionLinks, siteLinks } from './docs-links.mjs';

export const EDIT_PATH = '/_kit/edit';
const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '../bin/kit');
const MAX_BODY = 1_000_000;

// .agentkit text -> { edit, hosts } (for a key set twice, the last line wins, like `kit`)
export function editSettings(text) {
  const last = (key) => {
    let value = '';
    for (const m of String(text ?? '').matchAll(new RegExp(`^${key}=(.*)$`, 'gm'))) value = m[1].trim();
    return value;
  };
  return {
    edit: /^on$/i.test(last('DOCS_EDIT')),
    hosts: last('DOCS_EDIT_HOSTS').toLowerCase().split(/[\s,]+/).filter(Boolean),
  };
}

// The Host header without its port ("[::1]:4321" -> "::1")
export function hostName(header) {
  const h = String(header ?? '').trim().toLowerCase();
  if (h.startsWith('[')) return h.includes(']') ? h.slice(1, h.indexOf(']')) : '';
  return h.replace(/:\d+$/, '');
}

export function hostAllowed(header, hosts = []) {
  const name = hostName(header);
  return !!name && (isIP(name) !== 0 || name === 'localhost' || hosts.includes(name));
}

export function sameOrigin(origin, host) {
  try {
    return new URL(String(origin)).host.toLowerCase() === String(host ?? '').trim().toLowerCase();
  } catch {
    return false;
  }
}

const parseRange = (text) => {
  const m = /^(\d{1,9})-(\d{1,9})$/.exec(text ?? '');
  return m && Number(m[2]) > Number(m[1]) ? { s: Number(m[1]), e: Number(m[2]) } : null;
};

// A built page -> { file, hash, title, allowed } (what the website build marked: the page's file,
// its SHA-256 then, and each editable range with its kind), or null when it has no editing.
export function pageInfo(html) {
  const tag = /<kit-page-edit\b[^>]*>/.exec(String(html ?? ''))?.[0];
  if (!tag) return null;
  const attr = (name) => {
    const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag);
    return m ? decodeHtml(m[1]) : '';
  };
  const file = attr('data-file');
  const hash = attr('data-hash');
  if (!file || !/^[0-9a-f]{64}$/.test(hash)) return null;
  const allowed = new Map();
  for (const m of html.matchAll(/<span\b[^>]*?\sdata-kit-src="(\d{1,9}-\d{1,9})"[^>]*>/g)) {
    const range = parseRange(m[1]);
    if (!range) continue;
    const kind = (/\sdata-kit-kind="([a-z]{1,8})"/.exec(m[0])?.[1] ?? '').replace(/y/g, '');
    const outer = parseRange(/\sdata-kit-outer="(\d{1,9}-\d{1,9})"/.exec(m[0])?.[1]);
    allowed.set(`${range.s}-${range.e}`, { ...range, kind, outer });
  }
  const title = parseRange(attr('data-title-src'));
  if (title) allowed.set(`${title.s}-${title.e}`, { ...title, kind: 'y', outer: null });
  return { file, hash, title: attr('data-page-title'), allowed };
}

// Tools run with HOME and the PATH of this node (a service may start without them)
export function toolEnv(env = process.env) {
  const bin = dirname(process.execPath);
  const path = env.PATH || '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  return { ...env, HOME: env.HOME || homedir(), PATH: path.split(':').includes(bin) ? path : `${bin}:${path}` };
}

function run(cmd, args, { cwd, timeout = 120_000 } = {}) {
  return new Promise((done) => {
    execFile(cmd, args, { cwd, timeout, maxBuffer: 32 * 1024 * 1024, env: toolEnv() }, (error, out, err) => {
      done({ code: error ? (Number.isInteger(error.code) ? error.code : 1) : 0, out: String(out ?? ''), err: String(err ?? '') });
    });
  });
}
const lastLines = (text, n) => String(text).trimEnd().split('\n').slice(-n).join('\n');

// The real build: `kit docs build` in the project (keeps the old website when it fails)
export async function buildWebsite(root) {
  const r = await run(KIT, ['docs', 'build'], { cwd: root, timeout: 30 * 60_000 });
  return { ok: r.code === 0, output: lastLines(`${r.out}\n${r.err}`, 30) };
}

// Save those files in git, as one version (nothing else the project may have staged)
export async function saveInGit(root, rels, message) {
  const files = [rels].flat();
  const add = await run('git', ['-C', root, 'add', '--', ...files]);
  const commit = add.code === 0 ? await run('git', ['-C', root, 'commit', '-q', '-m', message, '--', ...files]) : add;
  if (commit.code !== 0) return { ok: false, output: lastLines(commit.err || commit.out, 10) };
  const head = await run('git', ['-C', root, 'rev-parse', '--short', 'HEAD']);
  return { ok: true, version: head.out.trim() };
}

function send(res, status, body, head = false) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(head ? undefined : JSON.stringify(body));
}
const refuse = (status, error, message, extra = {}) => ({ status, body: { error, message, ...extra } });

function readBody(req, limit) {
  return new Promise((done, failed) => {
    if (Number(req.headers['content-length'] || 0) > limit) {
      req.resume();
      failed(Object.assign(new Error('too big'), { code: 'TOO_BIG' }));
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= limit) chunks.push(chunk);
    });
    req.on('end', () => (size > limit
      ? failed(Object.assign(new Error('too big'), { code: 'TOO_BIG' }))
      : done(Buffer.concat(chunks).toString('utf8'))));
    req.on('error', failed);
  });
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const oneLine = (text) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);

// The /_kit/edit handler of a docs server. `dist`: the built website; `findFile(urlPath)`: the
// file a URL serves (docs-serve.mjs); `build(root)` / `save(root, files, message)`: replaced in tests.
export function editHandler({ dist, findFile, build = buildWebsite, save = saveInGit, log = console.log }) {
  const distDir = resolve(dist);
  const docsDir = dirname(distDir);
  let projectRoot = '';
  let queue = Promise.resolve();

  async function project() {
    if (!projectRoot) {
      const r = await run('git', ['-C', docsDir, 'rev-parse', '--show-toplevel']);
      if (r.code !== 0) return null;
      projectRoot = r.out.trim();
    }
    let text = '';
    try {
      text = await readFile(join(projectRoot, '.agentkit'), 'utf8');
    } catch {
      /* no settings: editing off */
    }
    return { root: projectRoot, ...editSettings(text) };
  }

  // A page's Markdown file (a path from the docs folder, as the build wrote it): a page inside the
  // docs folder's src/content/ (links followed), or '' when it is not one
  async function pageFile(fromDocs) {
    try {
      const content = await realpath(join(docsDir, 'src/content'));
      const real = await realpath(resolve(docsDir, fromDocs));
      return real.startsWith(content + sep) && /\.mdx?$/i.test(real) && (await stat(real)).isFile() ? real : '';
    } catch {
      return '';
    }
  }
  const savedInGit = async (root, file) => {
    const r = await run('git', ['-C', root, 'status', '--porcelain', '--', relative(root, file)]);
    return r.code === 0 && !r.out.trim();
  };

  async function saveEdits(root, { page, edits }) {
    const htmlFile = await findFile(page);
    if (!htmlFile || extname(htmlFile) !== '.html') return refuse(404, 'notfound', 'This page was not found on the website.');
    const html = await readFile(htmlFile, 'utf8');
    const info = pageInfo(html);
    if (!info) return refuse(404, 'notfound', 'This page cannot be edited.');
    const file = await pageFile(info.file);
    if (!file) return refuse(404, 'notfound', "This page's file was not found.");
    const bytes = await readFile(file);
    if (sha256(bytes) !== info.hash) return refuse(409, 'changed', 'The page changed since the website was built: reload it.');
    const rel = relative(root, file);
    if (!(await savedInGit(root, file))) {
      return refuse(409, 'unsaved', 'The page has changes not saved in git yet: save them first (kit docs update).');
    }
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) return refuse(400, 'failed', "The page's file is not UTF-8 text.");
    const result = applyEdits(text, edits, info.allowed, { mdx: /\.mdx$/i.test(file) });
    if (result.error) return refuse(result.error === 'changed' ? 409 : 400, result.error, result.message);
    if (!result.changed) return { status: 200, body: { ok: true, version: '', unchanged: true } };
    // A heading's #anchor comes from its text: a renamed heading needs its links checked
    const headings = edits.some((e) => info.allowed.get(`${e.s}-${e.e}`)?.kind.includes('h'));
    const before = headings ? await siteLinks(distDir) : null;

    await writeFile(file, result.text);
    const built = await build(root);
    if (!built.ok) {
      await writeFile(file, bytes); // the old text back: it matches the website, which stays as it was
      log(`Docs edit: ${rel} not saved, the website build failed`);
      return refuse(500, 'build', 'The website could not be built with this change: the page was put back.', { detail: built.output });
    }
    let links = { files: [], count: 0 };
    if (before) {
      links = await updateSectionLinks(root, { url: pageUrl(htmlFile.slice(distDir.length).split(sep).join('/')), file, bytes, before });
      if (links.refused) return links.refused;
    }
    const title = oneLine(info.title) || basename(file);
    const message = `docs: edit "${title}" in the browser${links.count ? ` (${links.count} link${links.count === 1 ? '' : 's'} to renamed sections updated)` : ''}`;
    const saved = await save(root, [rel, ...links.files.map((f) => relative(root, f))], message);
    log(`Docs edit: ${rel} saved${links.count ? ` with ${links.count} links updated` : ''}${saved.ok ? ` (${saved.version})` : ', not recorded in git'}`);
    const done = saved.ok ? { ok: true, version: saved.version } : { ok: true, version: '', warning: 'git', detail: saved.output };
    return { status: 200, body: links.count ? { ...done, links: links.count, pages: links.files.length } : done };
  }

  // After a save that changed a heading (the new website is built): the links of the site's pages
  // to a renamed section of the page at `url` get its new #anchor, in their Markdown files; the
  // website is built again and checked. Anything that can't be done: every file back as it was,
  // the website built again, and the save refused with the links concerned.
  // -> { files (other pages updated), count (links updated) } or { refused }
  async function updateSectionLinks(root, { url, file, bytes, before }) {
    let site = await siteLinks(distDir);
    const renamed = renamedSections(before.get(url)?.headings, site.get(url)?.headings);
    const written = new Map([[file, bytes]]); // file -> its text before the save
    const putBack = async (problems) => {
      for (const [f, old] of written) await writeFile(f, old);
      await build(root);
      log(`Docs edit: ${relative(root, file)} not saved, links to a renamed section could not be updated`);
      return {
        refused: refuse(409, 'links', 'Links to the renamed section could not be updated: the page was put back.', { detail: [...new Set(problems)].slice(0, 20) }),
      };
    };
    const brokenBefore = brokenLinks(before);
    // The links of page text that led to a renamed section, per linking page (the old website)
    const wanted = new Map();
    for (const [from, page] of before) {
      const n = page.links.filter((l) => l.path === url && renamed.has(l.fragment)).length;
      if (n) wanted.set(from, n);
    }
    let count = 0;
    const problems = [];
    for (const [from, n] of wanted) {
      const source = before.get(from).source && (await pageFile(before.get(from).source));
      const hrefs = before.get(from).links.filter((l) => l.path === url && renamed.has(l.fragment)).map((l) => `${from} → ${l.href}`);
      if (!source) {
        problems.push(...hrefs.map((h) => `${h} (no Markdown file for that page)`));
        continue;
      }
      if (source !== file && !(await savedInGit(root, source))) {
        problems.push(...hrefs.map((h) => `${h} (that page has changes not saved in git)`));
        continue;
      }
      const old = await readFile(source);
      const r = rewriteSectionLinks(old.toString('utf8'), from, url, renamed);
      if (r.count < n) {
        problems.push(...hrefs.map((h) => `${h} (not found in that page's Markdown)`));
        continue;
      }
      if (!written.has(source)) written.set(source, old);
      await writeFile(source, r.text);
      count += r.count;
    }
    if (problems.length) return putBack(problems);
    if (count) {
      const built = await build(root);
      if (!built.ok) return putBack([`the website could not be built with the updated links`]);
      site = await siteLinks(distDir);
    }
    // Checked on the new website: no link broken that worked before (the sidebar's too), and each
    // linking page now leads to the new sections
    const newIds = new Set(renamed.values());
    const fresh = new Map(); // link -> pages it is on
    for (const key of brokenLinks(site)) {
      if (brokenBefore.has(key)) continue;
      const [from, href] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)];
      fresh.set(href, [...(fresh.get(href) ?? []), from]);
    }
    for (const [href, pages] of fresh) {
      const where = pages.length === 1 ? pages[0] : `${pages.length} pages`;
      problems.push(`${where} → ${href} (not in a page's text: sidebar settings or a component)`);
    }
    for (const [from, n] of wanted) {
      if ((site.get(from)?.links.filter((l) => l.path === url && newIds.has(l.fragment)).length ?? 0) < n) {
        problems.push(`${from} → ${url} (still not leading to the renamed section)`);
      }
    }
    if (problems.length) return putBack(problems);
    return { files: [...written.keys()].filter((f) => f !== file), count };
  }

  return async function handle(req, res) {
    const p = await project();
    if (req.method === 'GET' || req.method === 'HEAD') {
      send(res, 200, { enabled: !!p?.edit }, req.method === 'HEAD');
      return;
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { allow: 'GET, HEAD, POST' }).end();
      return;
    }
    const answer = async () => {
      if (!p?.edit) return refuse(403, 'off', 'Editing is turned off for this website.');
      const h = req.headers;
      if (!hostAllowed(h.host, p.hosts) || !sameOrigin(h.origin, h.host) || h['x-kit-edit'] !== '1'
        || !/^application\/json\b/i.test(h['content-type'] || '')) {
        return refuse(403, 'forbidden', 'Not allowed from here.');
      }
      let body;
      try {
        body = JSON.parse(await readBody(req, MAX_BODY));
      } catch (error) {
        return refuse(error?.code === 'TOO_BIG' ? 413 : 400, 'bad', 'The changes could not be read.');
      }
      if (typeof body?.page !== 'string' || !Array.isArray(body.edits)) return refuse(400, 'bad', 'The changes could not be read.');
      // One save at a time: the next one waits for the build of this one
      const job = queue.then(() => saveEdits(p.root, body));
      queue = job.catch(() => {});
      return job;
    };
    let r;
    try {
      r = await answer();
    } catch (error) {
      r = refuse(500, 'failed', String(error?.message ?? error));
    }
    if (r.status !== 200 && r.body.error !== 'off') log(`Docs edit refused (${r.body.error}) from ${req.socket?.remoteAddress ?? '?'}`);
    if (!req.complete) req.resume();
    send(res, r.status, r.body);
  };
}
