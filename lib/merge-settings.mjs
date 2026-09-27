#!/usr/bin/env node
// Merge the kit's Claude Code settings into the user's ~/.claude/settings.json.
//   node merge-settings.mjs <kit-settings.json> <user-settings.json> [--remove]
// - Permission rules managed by the kit are added (and old kit rules that were
//   removed from the kit are cleaned up). Your own rules are never touched.
// - "model", "attribution" and "env" values are only set if you have not set them yourself.
// - A backup is written next to the file before any change.
import { readFileSync, writeFileSync, existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const [kitPath, userPath, flag] = process.argv.slice(2);
const remove = flag === '--remove';
const kit = JSON.parse(readFileSync(kitPath, 'utf8'));
const statePath = join(dirname(userPath), 'agent-kit-managed.json');

let user = {};
if (existsSync(userPath)) {
  const raw = readFileSync(userPath, 'utf8').trim();
  if (raw) {
    try { user = JSON.parse(raw); }
    catch (e) { console.error(`Cannot read ${userPath} (invalid JSON): ${e.message}. Fix or delete it, then re-run.`); process.exit(1); }
  }
  copyFileSync(userPath, userPath + '.bak-agent-kit');
} else {
  mkdirSync(dirname(userPath), { recursive: true });
}

let previous = { permissions: {}, setKeys: {} };
if (existsSync(statePath)) { try { previous = JSON.parse(readFileSync(statePath, 'utf8')); } catch {} }

user.permissions ??= {};
const managed = { permissions: {}, setKeys: { ...(previous.setKeys || {}) } };
for (const kind of ['allow', 'ask', 'deny']) {
  const mine = remove ? [] : (kit.permissions?.[kind] || []);
  const old = previous.permissions?.[kind] || [];
  let list = (user.permissions[kind] || []).filter(r => !old.includes(r) || mine.includes(r));
  for (const r of mine) if (!list.includes(r)) list.push(r);
  if (list.length) user.permissions[kind] = list; else delete user.permissions[kind];
  managed.permissions[kind] = mine;
}
if (!Object.keys(user.permissions).length) delete user.permissions;

if (!remove) {
  if (kit.model && user.model === undefined) { user.model = kit.model; managed.setKeys.model = kit.model; }
  if (kit.attribution && user.attribution === undefined) { user.attribution = kit.attribution; managed.setKeys.attribution = kit.attribution; }
  for (const [k, v] of Object.entries(kit.env || {})) {
    user.env ??= {};
    if (user.env[k] === undefined) { user.env[k] = v; managed.setKeys['env.' + k] = v; }
  }
} else {
  // undo only the values the kit set itself and that are unchanged
  for (const [k, v] of Object.entries(previous.setKeys || {})) {
    if (k === 'model' && user.model === v) delete user.model;
    if (k === 'attribution' && JSON.stringify(user.attribution) === JSON.stringify(v)) delete user.attribution;
    if (k.startsWith('env.') && user.env?.[k.slice(4)] === v) delete user.env[k.slice(4)];
  }
  if (user.env && !Object.keys(user.env).length) delete user.env;
}

writeFileSync(userPath, JSON.stringify(user, null, 2) + '\n');
if (remove) { try { writeFileSync(statePath, '{}\n'); } catch {} }
else writeFileSync(statePath, JSON.stringify(managed, null, 2) + '\n');
console.log(remove ? 'Removed kit settings from ' + userPath : 'Merged kit settings into ' + userPath);
