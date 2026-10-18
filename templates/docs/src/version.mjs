// agent-kit: managed file. `kit docs upgrade` replaces it with the kit's newest version;
// delete this line to keep your own version instead.
// Docs version shown next to the site title (components/SiteTitle.astro): the short id of
// the save the website was built from, and that save's date. Read once per build. Two sites
// (or a mirror) serving the same built files show the same id.
import { execFileSync } from 'node:child_process';

// docsVersion(dir) -> { id: '27ada09', saved: '2026-10-17 22:05' }, or empty values when
// there is no git history: the build never fails because of the version.
export function docsVersion(dir = process.cwd()) {
  try {
    const out = execFileSync(
      'git',
      ['-C', dir, 'log', '-1', '--format=%h|%cd', '--date=format:%Y-%m-%d %H:%M'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim();
    const [id = '', saved = ''] = out.split('|');
    return { id, saved };
  } catch {
    return { id: '', saved: '' };
  }
}
