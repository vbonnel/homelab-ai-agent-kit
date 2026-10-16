#!/usr/bin/env node
// consult.mjs - Multi-provider specialist delegation engine for homelab-ai-agent-kit.
// Supports Anthropic, OpenAI, and Google Gemini APIs over native HTTPS fetch (Node 20+).
// Read-only advisor: never executes shell commands or modifies project files.

import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { resolve, relative, dirname, basename, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const LF = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);
const BSLASH = String.fromCharCode(92);
const BT = String.fromCharCode(96);
const BT3 = BT.repeat(3);

function splitLines(str) {
  return String(str || '').replaceAll(CR, '').split(LF);
}

const VALID_TASKS = new Set(['review', 'investigate', 'tests', 'compare', 'ask']);
const PROVIDER_ALIASES = {
  anthropic: 'anthropic',
  claude: 'anthropic',
  openai: 'openai',
  gpt: 'openai',
  codex: 'openai',
  gemini: 'gemini',
  google: 'gemini',
};

// Approximate USD per 1M tokens [input, output] for cost estimation & guardrails
const MODEL_PRICING_PER_1M = {
  'claude-sonnet-4-5': [3.0, 15.0],
  'claude-opus-4-5': [15.0, 75.0],
  'claude-3-7-sonnet-latest': [3.0, 15.0],
  'claude-3-5-haiku-latest': [0.8, 4.0],
  'gpt-5': [2.5, 10.0],
  'gpt-5-mini': [0.4, 1.6],
  'gpt-6-luna': [2.5, 10.0],
  'gpt-4.1': [2.0, 8.0],
  'gpt-4.1-mini': [0.4, 1.6],
  'o3': [2.0, 8.0],
  'o4-mini': [1.1, 4.4],
  'gemini-2.5-pro': [1.25, 10.0],
  'gemini-2.5-flash': [0.3, 2.5],
  'gemini-2.0-flash': [0.1, 0.4],
};
const DEFAULT_PRICING_PER_1M = [3.0, 15.0];

const DEFAULT_CONFIG = {
  CONSULT_PROVIDERS: 'anthropic,openai,gemini',
  CONSULT_DEFAULT_PROVIDER: 'gemini',
  CONSULT_MODEL_ANTHROPIC: 'claude-sonnet-4-5',
  CONSULT_MODEL_OPENAI: 'gpt-5',
  CONSULT_MODEL_GEMINI: 'gemini-2.5-pro',
  CONSULT_ALLOWED_MODELS:
    'claude-sonnet-4-5,claude-opus-4-5,claude-3-7-sonnet-latest,claude-3-5-haiku-latest,gpt-5,gpt-5-mini,gpt-6-luna,gpt-4.1,gpt-4.1-mini,o3,o4-mini,gemini-2.5-pro,gemini-2.5-flash',
  CONSULT_TIMEOUT_SECS: '120',
  CONSULT_MAX_INPUT_BYTES: '120000',
  CONSULT_MAX_OUTPUT_TOKENS: '4096',
  CONSULT_MAX_COST_CALL_USD: '0.50',
  CONSULT_MAX_COST_DAILY_USD: '5.00',
  CONSULT_MAX_CALLS_SESSION: '15',
  CONSULT_API_URL_ANTHROPIC: 'https://api.anthropic.com/v1/messages',
  CONSULT_API_URL_OPENAI: 'https://api.openai.com/v1/chat/completions',
  CONSULT_API_URL_GEMINI: 'https://generativelanguage.googleapis.com/v1beta/models',
  CODEMAP: 'codebase.md',
  DOCS_DIR: 'docs',
};

// ------------------------------------------------------------ File parsers ---
export function parseEnvFile(filePath) {
  const out = {};
  if (!filePath || !existsSync(filePath)) return out;
  const content = readFileSync(filePath, 'utf8');
  for (const rawLine of splitLines(content)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    let [, key, val] = m;
    val = val.trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    } else {
      const hashIdx = val.indexOf(' #');
      if (hashIdx !== -1) val = val.slice(0, hashIdx).trim();
    }
    out[key] = val;
  }
  return out;
}

// --------------------------------------------------- Secret & Path Guards ---
export function redactSecrets(text) {
  if (!text) return '';
  let out = String(text);
  // Private key blocks
  out = out.replace(
    /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
    '[REDACTED_PRIVATE_KEY]'
  );
  // Known API token prefixes
  out = out.replace(/\bsk-ant-[A-Za-z0-9_-]{8,}\b/g, 'sk-ant-[REDACTED]');
  out = out.replace(/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{12,}\b/g, 'sk-[REDACTED]');
  out = out.replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, 'AIza[REDACTED]');
  out = out.replace(/\bgh[pousr]_[A-Za-z0-9_]{16,}\b/g, 'gh_[REDACTED]');
  out = out.replace(/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, 'xox-[REDACTED]');
  // Embedded URL credentials
  out = out.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^:\s/]+:)([^@\s/]+)(@)/g,
    '$1[REDACTED]$3'
  );
  // Bearer tokens
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, '$1[REDACTED]');
  // Env-style secret assignments line by line
  const redactedLines = splitLines(out).map((line) =>
    line.replace(
      /^(\s*(?:export\s+)?[A-Za-z0-9_]*(?:API_KEY|SECRET|PASSWORD|PASSWD|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY)[A-Za-z0-9_]*\s*=\s*)(?!""|''|$|\s*#)(.+)$/i,
      '$1[REDACTED]'
    )
  );
  return redactedLines.join(LF);
}

export function isForbiddenPath(relPath, codemapName = 'codebase.md', hasLineSlice = false) {
  const norm = String(relPath || '')
    .replaceAll(BSLASH, '/')
    .replace(/^\.\//, '');
  const base = basename(norm);

  if (norm.startsWith('..') || norm.includes('/../')) {
    return 'Path is outside the project root.';
  }
  if (
    (base === '.env' || base.startsWith('.env.')) &&
    base !== '.env.workcopy' &&
    base !== '.env.example' &&
    base !== '.env.sample' &&
    base !== '.env.template'
  ) {
    return `Refusing to read secret environment file '${relPath}'.`;
  }
  if (/\.(pem|key|p12|pfx|jks|keystore)$/i.test(base) || /^id_(rsa|ed25519|ecdsa|dsa)/i.test(base)) {
    return `Refusing to read private key/certificate file '${relPath}'.`;
  }
  if (/\.(db|sqlite|sqlite3)$/i.test(base)) {
    return `Refusing to read database file '${relPath}'.`;
  }
  if (norm === '.kit/delegation-scope.json') {
    return `Refusing to read internal state file '${relPath}'.`;
  }
  if ((norm === codemapName || base === codemapName) && !hasLineSlice) {
    return `Refusing to send full code map '${relPath}' (too large). Pass specific files or a line slice (${relPath}:1-100).`;
  }
  return null;
}

// --------------------------------------------------- Git & Repo Resolution ---
function resolveGitContext(cwd) {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const gitDir = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-dir'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    const commonDir = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    ).trim();
    const main = dirname(commonDir);
    const inWorkcopy = gitDir !== commonDir;
    return { inRepo: true, root, main, inWorkcopy, commonDir };
  } catch {
    return { inRepo: false, root: cwd, main: cwd, inWorkcopy: false, commonDir: null };
  }
}

function ensureKitExcluded(gitCtx) {
  if (!gitCtx.inRepo || !gitCtx.commonDir) return;
  try {
    const excludePath = join(gitCtx.commonDir, 'info', 'exclude');
    mkdirSync(dirname(excludePath), { recursive: true });
    const current = existsSync(excludePath) ? readFileSync(excludePath, 'utf8') : '';
    if (!splitLines(current).includes('.kit/')) {
      appendFileSync(excludePath, (current && !current.endsWith(LF) ? LF : '') + '.kit/' + LF);
    }
  } catch {
    // Non-fatal
  }
}

// -------------------------------------------- Configuration & Credentials ---
export function loadConfiguration(gitCtx, kitConfPath) {
  const confDir = dirname(kitConfPath);
  const globalConf = parseEnvFile(kitConfPath);
  const mainProjectConf = parseEnvFile(join(gitCtx.main, '.agentkit'));
  const rootProjectConf =
    gitCtx.root !== gitCtx.main ? parseEnvFile(join(gitCtx.root, '.agentkit')) : {};

  const cfg = { ...DEFAULT_CONFIG, ...globalConf, ...mainProjectConf, ...rootProjectConf };
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (process.env[key] !== undefined && process.env[key] !== '') {
      cfg[key] = process.env[key];
    }
  }
  cfg._confDir = confDir;
  cfg._kitConfPath = kitConfPath;
  return cfg;
}

export function loadCredentials(gitCtx, confDir) {
  const mainEnv = parseEnvFile(join(gitCtx.main, '.env'));
  const secretsEnv = parseEnvFile(join(confDir, 'secrets.env'));

  const pick = (...names) => {
    for (const n of names) {
      if (mainEnv[n]) return mainEnv[n];
    }
    for (const n of names) {
      if (secretsEnv[n]) return secretsEnv[n];
    }
    for (const n of names) {
      if (process.env[n]) return process.env[n];
    }
    return '';
  };

  return {
    anthropic: pick('CONSULT_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'),
    openai: pick('CONSULT_OPENAI_API_KEY', 'OPENAI_API_KEY', 'LUNA_OPENAI_API_KEY'),
    gemini: pick('CONSULT_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'),
  };
}

// ------------------------------------------- Provider & Model Resolution ---
export function normalizeProvider(raw) {
  if (!raw) return '';
  const clean = String(raw).trim().toLowerCase();
  return PROVIDER_ALIASES[clean] || clean;
}

export function inferProviderFromModel(model) {
  if (!model) return '';
  const m = model.trim().toLowerCase();
  if (m.startsWith('claude-')) return 'anthropic';
  if (
    m.startsWith('gpt-') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.startsWith('codex')
  ) {
    return 'openai';
  }
  if (m.startsWith('gemini-')) return 'gemini';
  return '';
}

function defaultModelForProvider(provider, cfg) {
  if (provider === 'anthropic') return cfg.CONSULT_MODEL_ANTHROPIC;
  if (provider === 'openai') return cfg.CONSULT_MODEL_OPENAI;
  if (provider === 'gemini') return cfg.CONSULT_MODEL_GEMINI;
  return '';
}

export function resolveProviderAndModel({
  requestedProvider,
  requestedModel,
  orchestrator,
  cfg,
  credentials,
  scopeData,
}) {
  const configuredProviders = cfg.CONSULT_PROVIDERS.split(',')
    .map((s) => normalizeProvider(s))
    .filter(Boolean);
  const allowedModelsRaw = (cfg.CONSULT_ALLOWED_MODELS || '').trim();
  const allowedModels =
    allowedModelsRaw === '*'
      ? null
      : new Set(
          allowedModelsRaw
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
        );

  let provider = normalizeProvider(requestedProvider);
  let model = (requestedModel || '').trim();

  if (!provider && model) {
    provider = inferProviderFromModel(model);
    if (!provider) {
      return {
        error: `Cannot infer provider from model '${model}'. Specify --provider anthropic|openai|gemini.`,
      };
    }
  }

  if (!provider) {
    const orch = (
      orchestrator ||
      process.env.CONSULT_ORCHESTRATOR ||
      (process.env.CLAUDECODE ? 'claude' : process.env.CODEX_SANDBOX ? 'codex' : '')
    ).toLowerCase();

    const preferredOrder = [];
    const defProv = normalizeProvider(cfg.CONSULT_DEFAULT_PROVIDER);
    if (defProv) preferredOrder.push(defProv);

    if (orch === 'claude' || orch === 'anthropic') {
      preferredOrder.push('gemini', 'openai', 'anthropic');
    } else if (orch === 'codex' || orch === 'openai') {
      preferredOrder.push('gemini', 'anthropic', 'openai');
    } else {
      preferredOrder.push('gemini', 'anthropic', 'openai');
    }

    const candidates = [...new Set(preferredOrder)].filter((p) =>
      configuredProviders.includes(p)
    );
    const scopeProviders =
      scopeData && Array.isArray(scopeData.providers) && !scopeData.providers.includes('*')
        ? new Set(scopeData.providers)
        : null;

    provider =
      candidates.find(
        (p) => credentials[p] && (!scopeProviders || scopeProviders.has(p))
      ) ||
      candidates.find((p) => !scopeProviders || scopeProviders.has(p)) ||
      configuredProviders[0] ||
      'gemini';
  }

  if (!configuredProviders.includes(provider)) {
    return {
      error: `Provider '${provider}' is not enabled in CONSULT_PROVIDERS (${cfg.CONSULT_PROVIDERS}).`,
    };
  }

  if (!model) {
    model = defaultModelForProvider(provider, cfg);
  }

  if (allowedModels && !allowedModels.has(model)) {
    return {
      error: `Model '${model}' is not in the approved list (CONSULT_ALLOWED_MODELS=${cfg.CONSULT_ALLOWED_MODELS}).`,
    };
  }

  return { provider, model };
}

// ------------------------------------------------ Scope & Authorization ---
function getScopeFilePath(gitCtx, useMain = false) {
  const baseDir = useMain ? gitCtx.main : gitCtx.root;
  return join(baseDir, '.kit', 'delegation-scope.json');
}

export function readActiveScope(gitCtx) {
  const candidates = [getScopeFilePath(gitCtx, false)];
  if (gitCtx.root !== gitCtx.main) {
    candidates.push(getScopeFilePath(gitCtx, true));
  }
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    try {
      const data = JSON.parse(readFileSync(p, 'utf8'));
      if (!data || !data.enabled) continue;
      if (data.expires_at && Date.now() > Date.parse(data.expires_at)) {
        return { active: false, expired: true, path: p, data };
      }
      if (
        typeof data.max_calls === 'number' &&
        typeof data.calls_used === 'number' &&
        data.calls_used >= data.max_calls
      ) {
        return { active: false, exhausted: true, path: p, data };
      }
      return { active: true, path: p, data };
    } catch {
      // Ignore malformed scope file
    }
  }
  return { active: false, path: candidates[0], data: null };
}

export function checkAuthorization({ authorizedOnce, task, provider, gitCtx }) {
  const scopeInfo = readActiveScope(gitCtx);
  if (scopeInfo.active && scopeInfo.data) {
    const s = scopeInfo.data;
    const providerOk =
      !s.providers || s.providers.includes('*') || s.providers.includes(provider);
    const taskOk = !s.tasks || s.tasks.includes('*') || s.tasks.includes(task);
    if (providerOk && taskOk) {
      return {
        authorized: true,
        mode: 'session-scope',
        scopePath: scopeInfo.path,
        scopeData: s,
      };
    }
  }

  if (authorizedOnce) {
    return {
      authorized: true,
      mode: 'authorized-once',
      scopePath: null,
      scopeData: null,
    };
  }

  let reason =
    'External delegation is disabled by default. Only delegate when the owner explicitly requests or authorizes it.';
  if (scopeInfo.expired) {
    reason = `Session delegation scope expired at ${scopeInfo.data.expires_at}.`;
  } else if (scopeInfo.exhausted) {
    reason = `Session delegation scope reached its call limit (${scopeInfo.data.calls_used}/${scopeInfo.data.max_calls}).`;
  } else if (scopeInfo.active) {
    reason = `Active session scope does not cover provider='${provider}' and task='${task}'.`;
  }

  return {
    authorized: false,
    reason,
  };
}

function incrementScopeUsage(scopePath, scopeData) {
  if (!scopePath || !scopeData) return;
  try {
    scopeData.calls_used = (scopeData.calls_used || 0) + 1;
    scopeData.last_used_at = new Date().toISOString();
    writeFileSync(scopePath, JSON.stringify(scopeData, null, 2) + LF);
  } catch {
    // Non-fatal
  }
}

// ------------------------------------------------ Cost & Usage Tracking ---
export function estimateCostUsd(model, inputTokens, outputTokens) {
  const [inRate, outRate] = MODEL_PRICING_PER_1M[model] || DEFAULT_PRICING_PER_1M;
  const cost = (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function getDailySpendUsd(confDir) {
  const usageFile = join(confDir, 'consult-usage.tsv');
  if (!existsSync(usageFile)) return 0;
  const todayPrefix = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  let total = 0;
  const lines = splitLines(readFileSync(usageFile, 'utf8'));
  for (const line of lines) {
    if (!line || line.startsWith('#')) continue;
    const cols = line.split(TAB);
    if (cols[0] && cols[0].startsWith(todayPrefix) && cols[9]) {
      const val = parseFloat(cols[9].replace(/^\$/, ''));
      if (!Number.isNaN(val)) total += val;
    }
  }
  return Math.round(total * 1_000_000) / 1_000_000;
}

function recordUsage({
  stamp,
  gitCtx,
  featureName,
  task,
  provider,
  model,
  secs,
  inputTokens,
  outputTokens,
  costUsd,
  status,
  confDir,
}) {
  const totalTokens = (inputTokens || 0) + (outputTokens || 0);
  const projectRunsDir = join(gitCtx.root, '.kit', 'runs');
  mkdirSync(projectRunsDir, { recursive: true });

  const localLine = [
    stamp,
    featureName || basename(gitCtx.root),
    `consult:${task}:${provider}:${model}`,
    `${secs}s`,
    `${totalTokens} (in:${inputTokens || 0},out:${outputTokens || 0},$${costUsd.toFixed(4)})`,
  ].join(TAB);
  appendFileSync(join(projectRunsDir, 'usage.tsv'), localLine + LF);

  try {
    mkdirSync(confDir, { recursive: true });
    const globalLine = [
      stamp,
      basename(gitCtx.main),
      featureName || (gitCtx.inWorkcopy ? basename(gitCtx.root) : 'main'),
      task,
      provider,
      model,
      `${secs}s`,
      String(inputTokens || 0),
      String(outputTokens || 0),
      costUsd.toFixed(6),
      status,
    ].join(TAB);
    appendFileSync(join(confDir, 'consult-usage.tsv'), globalLine + LF);
  } catch {
    // Non-fatal
  }
}

// ---------------------------------------------------- Context Assembly ---
function readSelectedFile(specStr, gitCtx, codemapName) {
  let filePart = specStr;
  let startLine = null;
  let endLine = null;

  const sliceMatch = specStr.match(/^(.*):(\d+)-(\d+)$/);
  if (sliceMatch) {
    filePart = sliceMatch[1];
    startLine = parseInt(sliceMatch[2], 10);
    endLine = parseInt(sliceMatch[3], 10);
  }

  const absPath = resolve(gitCtx.root, filePart);
  const relToRoot = relative(gitCtx.root, absPath);
  const forbiddenReason = isForbiddenPath(relToRoot, codemapName, startLine !== null);
  if (forbiddenReason) {
    throw new Error(forbiddenReason);
  }

  if (!existsSync(absPath)) {
    throw new Error(`File not found: ${filePart}`);
  }

  const realAbs = realpathSync(absPath);
  const realMain = existsSync(gitCtx.main) ? realpathSync(gitCtx.main) : gitCtx.main;
  const realRoot = existsSync(gitCtx.root) ? realpathSync(gitCtx.root) : gitCtx.root;
  if (
    !realAbs.startsWith(realRoot + '/') &&
    realAbs !== realRoot &&
    !realAbs.startsWith(realMain + '/') &&
    realAbs !== realMain
  ) {
    throw new Error(`Refusing to read file outside project boundaries: ${filePart}`);
  }
  const realRel = relative(realMain, realAbs);
  const realForbidden = isForbiddenPath(realRel, codemapName, startLine !== null);
  if (realForbidden) {
    throw new Error(realForbidden);
  }

  const st = statSync(realAbs);
  if (!st.isFile()) {
    throw new Error(`Not a regular file: ${filePart}`);
  }

  const rawContent = readFileSync(realAbs, 'utf8');
  const lines = splitLines(rawContent);
  let selectedText;
  let label = relToRoot;

  if (startLine !== null && endLine !== null) {
    const s = Math.max(1, startLine);
    const e = Math.min(lines.length, endLine);
    selectedText = lines
      .slice(s - 1, e)
      .map((l, idx) => `${s + idx}: ${l}`)
      .join(LF);
    label = `${relToRoot} (lines ${s}-${e})`;
  } else {
    selectedText = rawContent;
  }

  return {
    label,
    content: redactSecrets(selectedText),
  };
}

function collectGitDiff(gitCtx, diffRange, codemapName) {
  if (!gitCtx.inRepo) {
    throw new Error('Cannot collect --diff outside a git repository.');
  }
  const excludes = [
    `:(exclude)${codemapName}`,
    ':(exclude)*.lock',
    ':(exclude)package-lock.json',
    ':(exclude).env',
    ':(exclude).env.*',
    ':(exclude)*.pem',
    ':(exclude)*.key',
  ];

  let rangeArgs = [];
  if (diffRange && diffRange !== 'auto') {
    rangeArgs = [diffRange];
  } else if (gitCtx.inWorkcopy) {
    let target = 'main';
    const targetFile = join(gitCtx.root, '.kit', 'target-branch');
    if (existsSync(targetFile)) {
      target = readFileSync(targetFile, 'utf8').trim() || 'main';
    }
    try {
      const base = execFileSync('git', ['merge-base', 'HEAD', target], {
        cwd: gitCtx.root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      rangeArgs = [`${base}..HEAD`];
    } catch {
      rangeArgs = ['HEAD'];
    }
  } else {
    rangeArgs = ['HEAD'];
  }

  try {
    const statOut = execFileSync(
      'git',
      ['diff', '--stat', ...rangeArgs, '--', '.', ...excludes],
      { cwd: gitCtx.root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    ).trim();
    let patchOut = execFileSync(
      'git',
      ['diff', ...rangeArgs, '--', '.', ...excludes],
      { cwd: gitCtx.root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
    ).trim();

    if (gitCtx.inWorkcopy && (!diffRange || diffRange === 'auto')) {
      const wtDiff = execFileSync(
        'git',
        ['diff', 'HEAD', '--', '.', ...excludes],
        { cwd: gitCtx.root, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }
      ).trim();
      if (wtDiff && !patchOut.includes(wtDiff)) {
        patchOut = [patchOut, '# Uncommitted working-tree changes:', wtDiff]
          .filter(Boolean)
          .join(LF + LF);
      }
    }

    if (!statOut && !patchOut) {
      return 'No diff changes found for the selected range.';
    }
    return redactSecrets(`${statOut}${LF}${LF}${patchOut}`.trim());
  } catch (err) {
    throw new Error(`Failed to collect git diff: ${err.message}`);
  }
}

export function buildConsultationPrompt({
  kitDir,
  task,
  gitCtx,
  cfg,
  featureName,
  specPath,
  files,
  includeDiff,
  diffRange,
  includeTestLog,
  question,
}) {
  const templatePath = join(kitDir, 'prompts', `consult-${task}.md`);
  if (!existsSync(templatePath)) {
    throw new Error(`Missing prompt template: ${templatePath}`);
  }
  const systemInstructions = readFileSync(templatePath, 'utf8').trim();
  const sections = [];

  const agentsPath = join(gitCtx.root, 'AGENTS.md');
  if (existsSync(agentsPath)) {
    const rawAgents = readFileSync(agentsPath, 'utf8');
    if (Buffer.byteLength(rawAgents, 'utf8') <= 24000) {
      sections.push(`## Project Rules (AGENTS.md)${LF}${LF}${redactSecrets(rawAgents.trim())}`);
    }
  }

  const effectiveSpec =
    specPath || (featureName ? join('specs', `${featureName}.md`) : '');
  if (effectiveSpec) {
    const item = readSelectedFile(effectiveSpec, gitCtx, cfg.CODEMAP);
    sections.push(`## Feature Specification (${item.label})${LF}${LF}${item.content.trim()}`);
  }

  if (question && question.trim()) {
    sections.push(`## Consultation Request${LF}${LF}${redactSecrets(question.trim())}`);
  }

  if (files && files.length > 0) {
    const fileBlocks = [];
    for (const f of files) {
      const item = readSelectedFile(f, gitCtx, cfg.CODEMAP);
      fileBlocks.push(`### File: ${BT}${item.label}${BT}${LF}${BT3}${LF}${item.content}${LF}${BT3}`);
    }
    sections.push(`## Selected Files${LF}${LF}${fileBlocks.join(LF + LF)}`);
  }

  const shouldIncludeDiff =
    includeDiff || (task === 'review' && (!files || files.length === 0));
  if (shouldIncludeDiff) {
    const diffText = collectGitDiff(gitCtx, diffRange, cfg.CODEMAP);
    sections.push(`## Code Diff${LF}${LF}${BT3}diff${LF}${diffText}${LF}${BT3}`);
  }

  if (includeTestLog) {
    const testLogPath = join(gitCtx.root, '.kit', 'test-output.txt');
    if (existsSync(testLogPath)) {
      const lines = splitLines(readFileSync(testLogPath, 'utf8'));
      const tail = lines.slice(-120).join(LF);
      sections.push(`## Recent Test Output (.kit/test-output.txt)${LF}${LF}${BT3}${LF}${redactSecrets(tail)}${LF}${BT3}`);
    } else {
      sections.push(`## Recent Test Output${LF}${LF}(No .kit/test-output.txt found)`);
    }
  }

  if (sections.length === 0 || (sections.length === 1 && sections[0].startsWith('## Project Rules'))) {
    throw new Error(
      'No context or question provided. Pass --question "...", --file <path>, --diff, --spec <path>, or --test-log.'
    );
  }

  const userPrompt = sections.join(`${LF}${LF}---${LF}${LF}`);
  const fullPrompt = `${systemInstructions}${LF}${LF}===${LF}${LF}${userPrompt}${LF}`;
  const maxBytes = parseInt(cfg.CONSULT_MAX_INPUT_BYTES, 10) || 120000;
  const actualBytes = Buffer.byteLength(fullPrompt, 'utf8');

  if (actualBytes > maxBytes) {
    throw new Error(
      `Context size (${actualBytes} bytes) exceeds CONSULT_MAX_INPUT_BYTES (${maxBytes} bytes). Pass narrower line ranges (--file path:start-end) or fewer files.`
    );
  }

  return {
    systemInstructions,
    userPrompt,
    fullPrompt,
    promptBytes: actualBytes,
  };
}

// ---------------------------------------------------- Provider Adapters ---
async function callAnthropic({ apiUrl, apiKey, model, systemInstructions, userPrompt, maxOutputTokens, timeoutSecs }) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: maxOutputTokens,
      system: systemInstructions,
      messages: [{ role: 'user', content: userPrompt }],
    }),
    signal: AbortSignal.timeout(timeoutSecs * 1000),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${redactSecrets(rawText.slice(0, 400))}`);
  }
  const data = JSON.parse(rawText);
  const text = Array.isArray(data.content)
    ? data.content
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join(LF)
    : '';
  const inputTokens = data.usage?.input_tokens || 0;
  const outputTokens = data.usage?.output_tokens || 0;
  return { text: text.trim(), inputTokens, outputTokens, rawResponse: data };
}

async function callOpenAI({ apiUrl, apiKey, model, systemInstructions, userPrompt, maxOutputTokens, timeoutSecs }) {
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: maxOutputTokens,
      messages: [
        { role: 'developer', content: systemInstructions },
        { role: 'user', content: userPrompt },
      ],
    }),
    signal: AbortSignal.timeout(timeoutSecs * 1000),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${redactSecrets(rawText.slice(0, 400))}`);
  }
  const data = JSON.parse(rawText);
  let text = '';
  if (Array.isArray(data.choices) && data.choices[0]?.message?.content) {
    text = data.choices[0].message.content;
  } else if (typeof data.output_text === 'string') {
    text = data.output_text;
  }
  const inputTokens = data.usage?.prompt_tokens ?? data.usage?.input_tokens ?? 0;
  const outputTokens = data.usage?.completion_tokens ?? data.usage?.output_tokens ?? 0;
  return { text: text.trim(), inputTokens, outputTokens, rawResponse: data };
}

async function callGemini({ apiBaseUrl, apiKey, model, systemInstructions, userPrompt, maxOutputTokens, timeoutSecs }) {
  const base = apiBaseUrl.replace(/\/+$/, '');
  const endpoint = base.includes(':generateContent')
    ? base
    : `${base}/${encodeURIComponent(model)}:generateContent`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstructions }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        maxOutputTokens,
      },
    }),
    signal: AbortSignal.timeout(timeoutSecs * 1000),
  });

  const rawText = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${redactSecrets(rawText.slice(0, 400))}`);
  }
  const data = JSON.parse(rawText);
  const parts = data.candidates?.[0]?.content?.parts || [];
  const text = parts.map((p) => p.text || '').join(LF);
  const inputTokens = data.usageMetadata?.promptTokenCount || 0;
  const outputTokens = data.usageMetadata?.candidatesTokenCount || 0;
  return { text: text.trim(), inputTokens, outputTokens, rawResponse: data };
}

// --------------------------------------------------- Subcommand Handlers ---
function parseDurationSecs(str) {
  if (!str) return 4 * 3600;
  const m = String(str)
    .trim()
    .match(/^(\d+)\s*([smhd]?)$/i);
  if (!m) return 4 * 3600;
  const val = parseInt(m[1], 10);
  const unit = (m[2] || 'm').toLowerCase();
  if (unit === 's') return val;
  if (unit === 'm') return val * 60;
  if (unit === 'h') return val * 3600;
  if (unit === 'd') return val * 86400;
  return val * 60;
}

function handleScopeCommand(args, gitCtx, cfg) {
  const action = args[0] || 'status';
  const scopePath = getScopeFilePath(gitCtx, false);

  if (action === 'status') {
    const info = readActiveScope(gitCtx);
    if (!info.active) {
      if (info.expired) {
        console.log(`Delegation scope: EXPIRED (expired at ${info.data.expires_at})`);
      } else if (info.exhausted) {
        console.log(
          `Delegation scope: EXHAUSTED (${info.data.calls_used}/${info.data.max_calls} calls used)`
        );
      } else {
        console.log('Delegation scope: OFF (external API calls require explicit --authorized-once or scope enable)');
      }
      return 0;
    }
    const s = info.data;
    console.log(
      [
        `Delegation scope: ACTIVE (${info.path})`,
        `  providers: ${(s.providers || ['*']).join(', ')}`,
        `  tasks:     ${(s.tasks || ['*']).join(', ')}`,
        `  calls:     ${s.calls_used || 0}/${s.max_calls}`,
        `  expires:   ${s.expires_at}`,
      ].join(LF)
    );
    return 0;
  }

  if (action === 'disable' || action === 'off' || action === 'clear') {
    for (const p of [getScopeFilePath(gitCtx, false), getScopeFilePath(gitCtx, true)]) {
      if (existsSync(p)) {
        writeFileSync(p, JSON.stringify({ enabled: false, disabled_at: new Date().toISOString() }, null, 2) + LF);
      }
    }
    console.log('Delegation scope: DISABLED. External API calls are off by default.');
    return 0;
  }

  if (action === 'enable' || action === 'on') {
    let providers = ['*'];
    let tasks = ['*'];
    let ttlSecs = 4 * 3600;
    let maxCalls = parseInt(cfg.CONSULT_MAX_CALLS_SESSION, 10) || 15;

    for (let i = 1; i < args.length; i++) {
      const a = args[i];
      if ((a === '--providers' || a === '--provider' || a === '-p') && args[i + 1]) {
        providers = args[++i]
          .split(',')
          .map((x) => (x.trim() === '*' ? '*' : normalizeProvider(x)))
          .filter(Boolean);
      } else if ((a === '--tasks' || a === '--task' || a === '-t') && args[i + 1]) {
        tasks = args[++i]
          .split(',')
          .map((x) => x.trim().toLowerCase())
          .filter(Boolean);
      } else if (a === '--ttl' && args[i + 1]) {
        ttlSecs = parseDurationSecs(args[++i]);
      } else if (a === '--max-calls' && args[i + 1]) {
        maxCalls = parseInt(args[++i], 10) || maxCalls;
      }
    }

    ensureKitExcluded(gitCtx);
    mkdirSync(dirname(scopePath), { recursive: true });
    const now = new Date();
    const expires = new Date(now.getTime() + ttlSecs * 1000);
    const scopeObj = {
      enabled: true,
      enabled_at: now.toISOString(),
      expires_at: expires.toISOString(),
      providers,
      tasks,
      max_calls: maxCalls,
      calls_used: 0,
    };
    writeFileSync(scopePath, JSON.stringify(scopeObj, null, 2) + LF);
    console.log(
      [
        `Delegation scope ENABLED in ${scopePath}:`,
        `  providers: ${providers.join(', ')}`,
        `  tasks:     ${tasks.join(', ')}`,
        `  max_calls: ${maxCalls}`,
        `  expires:   ${expires.toISOString()}`,
      ].join(LF)
    );
    return 0;
  }

  console.error('Usage: consult scope status | enable [--providers p1,p2] [--tasks t1,t2] [--ttl 4h] [--max-calls 15] | disable');
  return 1;
}

function handleModelsCommand(gitCtx, cfg, credentials) {
  const providers = cfg.CONSULT_PROVIDERS.split(',')
    .map((p) => normalizeProvider(p))
    .filter(Boolean);
  console.log('Configured delegation providers & models:');
  for (const p of providers) {
    const defModel = defaultModelForProvider(p, cfg);
    const hasKey = Boolean(credentials[p]);
    console.log(
      `  - ${p.padEnd(10)} default=${defModel.padEnd(22)} key=${hasKey ? 'configured' : 'MISSING'}`
    );
  }
  console.log(`Approved models: ${cfg.CONSULT_ALLOWED_MODELS}`);
  console.log(`Default provider: ${cfg.CONSULT_DEFAULT_PROVIDER}`);
  console.log(
    `Limits: timeout=${cfg.CONSULT_TIMEOUT_SECS}s, max_call=$${cfg.CONSULT_MAX_COST_CALL_USD}, max_daily=$${cfg.CONSULT_MAX_COST_DAILY_USD}`
  );
  return 0;
}

function handleUsageCommand(gitCtx, cfg) {
  const dailyUsd = getDailySpendUsd(cfg._confDir);
  console.log(
    `Today's container delegation spend: $${dailyUsd.toFixed(4)} / $${cfg.CONSULT_MAX_COST_DAILY_USD} daily limit`
  );
  const localUsage = join(gitCtx.root, '.kit', 'runs', 'usage.tsv');
  if (existsSync(localUsage)) {
    const lines = splitLines(readFileSync(localUsage, 'utf8').trim()).filter((l) =>
      l.includes('consult:')
    );
    if (lines.length > 0) {
      console.log(`Recent consultations in ${gitCtx.root}:`);
      for (const l of lines.slice(-10)) {
        console.log(`  ${l}`);
      }
      return 0;
    }
  }
  console.log('No consultations recorded in this checkout yet.');
  return 0;
}

function printHelp() {
  console.log(`consult - Delegate read-only specialist tasks to Anthropic, OpenAI, or Google Gemini

Usage:
  consult <task> [options] [--question "..."]

Tasks:
  review        Independent code review of a diff, spec, or selected files
  investigate   Root-cause analysis of a bug or failing test log
  tests         Suggest edge-case and regression tests (safe for work copies)
  compare       Compare implementation approaches and tradeoffs
  ask           General read-only specialist question

Management subcommands:
  consult scope status
  consult scope enable [--providers anthropic,openai,gemini] [--tasks review,investigate] [--ttl 4h] [--max-calls 15]
  consult scope disable
  consult models
  consult usage

Options for <task>:
  --authorized-once          Confirm the owner explicitly requested this single consultation
  --provider, -p <name>      anthropic | openai | gemini (or let consult pick an approved default)
  --model, -m <model>        Model name (must be in CONSULT_ALLOWED_MODELS)
  --orchestrator <name>      Primary agent name (claude | codex) to prefer an independent provider
  --feature <name>           Feature name (loads specs/<name>.md)
  --spec <path>              Path to specification file
  --file, -f <path[:s-e]>    Attach a file or 1-based line range (repeatable)
  --diff [range]             Attach git diff (defaults to workcopy base..HEAD or HEAD)
  --test-log                 Attach tail of .kit/test-output.txt
  --question, -q "<text>"    Specific question or instructions for the specialist
`);
}

// ---------------------------------------------------------- Main Runner ---
export async function runCli(argv, env = {}) {
  const kitDir = env.kitDir || resolve(dirname(new URL(import.meta.url).pathname), '..');
  const kitConfPath =
    env.kitConfPath ||
    process.env.KIT_CONF ||
    join(homedir(), '.config', 'agent-kit', 'config');
  const cwd = env.cwd || process.cwd();

  const gitCtx = resolveGitContext(cwd);
  const cfg = loadConfiguration(gitCtx, kitConfPath);
  const credentials = loadCredentials(gitCtx, cfg._confDir);

  const sub = argv[0] || 'help';
  const rest = argv.slice(1);

  if (sub === 'help' || sub === '-h' || sub === '--help') {
    printHelp();
    return 0;
  }
  if (sub === 'scope') {
    return handleScopeCommand(rest, gitCtx, cfg);
  }
  if (sub === 'models') {
    return handleModelsCommand(gitCtx, cfg, credentials);
  }
  if (sub === 'usage') {
    return handleUsageCommand(gitCtx, cfg);
  }

  if (!VALID_TASKS.has(sub)) {
    console.error(`CONSULT ERROR: Unknown command '${sub}'. Run 'consult help'.`);
    return 1;
  }

  let authorizedOnce = false;
  let requestedProvider = '';
  let requestedModel = '';
  let orchestrator = '';
  let featureName = '';
  let specPath = '';
  const files = [];
  let includeDiff = false;
  let diffRange = 'auto';
  let includeTestLog = false;
  const questionParts = [];

  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--authorized-once' || a === '--allow-once') {
      authorizedOnce = true;
    } else if ((a === '--provider' || a === '-p') && rest[i + 1]) {
      requestedProvider = rest[++i];
    } else if ((a === '--model' || a === '-m') && rest[i + 1]) {
      requestedModel = rest[++i];
    } else if (a === '--orchestrator' && rest[i + 1]) {
      orchestrator = rest[++i];
    } else if (a === '--feature' && rest[i + 1]) {
      featureName = rest[++i];
    } else if (a === '--spec' && rest[i + 1]) {
      specPath = rest[++i];
    } else if ((a === '--file' || a === '-f') && rest[i + 1]) {
      files.push(rest[++i]);
    } else if (a === '--diff') {
      includeDiff = true;
      if (rest[i + 1] && !rest[i + 1].startsWith('-')) {
        diffRange = rest[++i];
      }
    } else if (a === '--test-log') {
      includeTestLog = true;
    } else if ((a === '--question' || a === '-q') && rest[i + 1]) {
      questionParts.push(rest[++i]);
    } else if (a.startsWith('-')) {
      console.error(`CONSULT ERROR: Unknown option '${a}'. Run 'consult help'.`);
      return 1;
    } else {
      questionParts.push(a);
    }
  }

  const scopeInfo = readActiveScope(gitCtx);
  const resolved = resolveProviderAndModel({
    requestedProvider,
    requestedModel,
    orchestrator,
    cfg,
    credentials,
    scopeData: scopeInfo.active ? scopeInfo.data : null,
  });

  if (resolved.error) {
    console.error(`CONSULT ERROR: ${resolved.error}`);
    return 2;
  }

  const { provider, model } = resolved;

  const auth = checkAuthorization({
    authorizedOnce,
    task: sub,
    provider,
    gitCtx,
  });

  if (!auth.authorized) {
    console.error(
      [
        `CONSULT BLOCKED: ${auth.reason}`,
        `To run a single user-requested delegation, pass --authorized-once.`,
        `To enable a session scope, run: consult scope enable --providers ${provider} --tasks ${sub}`,
      ].join(LF)
    );
    return 3;
  }

  const apiKey = credentials[provider];
  if (!apiKey) {
    const keyName =
      provider === 'anthropic'
        ? 'ANTHROPIC_API_KEY'
        : provider === 'openai'
          ? 'OPENAI_API_KEY'
          : 'GEMINI_API_KEY';
    console.error(
      [
        `CONSULT UNAVAILABLE: ${provider}/${model} - Missing API key (${keyName}).`,
        `Add ${keyName}=... to ${join(gitCtx.main, '.env')} (or ~/.config/agent-kit/secrets.env).`,
        `Primary agent: report this in one line and continue the normal workflow without delegation.`,
      ].join(LF)
    );
    return 4;
  }

  let promptBundle;
  try {
    promptBundle = buildConsultationPrompt({
      kitDir,
      task: sub,
      gitCtx,
      cfg,
      featureName,
      specPath,
      files,
      includeDiff,
      diffRange,
      includeTestLog,
      question: questionParts.join(' '),
    });
  } catch (err) {
    console.error(`CONSULT ERROR: ${err.message}`);
    return 2;
  }

  const estInputTokens = Math.ceil(promptBundle.promptBytes / 4);
  const maxOutputTokens = parseInt(cfg.CONSULT_MAX_OUTPUT_TOKENS, 10) || 4096;
  const estCallMaxUsd = estimateCostUsd(model, estInputTokens, maxOutputTokens);
  const maxCallUsd = parseFloat(cfg.CONSULT_MAX_COST_CALL_USD) || 0.5;
  const maxDailyUsd = parseFloat(cfg.CONSULT_MAX_COST_DAILY_USD) || 5.0;
  const dailySpendUsd = getDailySpendUsd(cfg._confDir);

  if (estCallMaxUsd > maxCallUsd) {
    console.error(
      `CONSULT BLOCKED: Estimated maximum call cost ($${estCallMaxUsd.toFixed(4)}) exceeds CONSULT_MAX_COST_CALL_USD ($${maxCallUsd.toFixed(2)}). Narrow the context or adjust config.`
    );
    return 5;
  }
  if (dailySpendUsd >= maxDailyUsd || dailySpendUsd + estCallMaxUsd > maxDailyUsd) {
    console.error(
      `CONSULT BLOCKED: Daily delegation spend ($${dailySpendUsd.toFixed(4)}) plus estimated call ($${estCallMaxUsd.toFixed(4)}) exceeds CONSULT_MAX_COST_DAILY_USD ($${maxDailyUsd.toFixed(2)}).`
    );
    return 5;
  }

  ensureKitExcluded(gitCtx);
  const runsDir = join(gitCtx.root, '.kit', 'runs');
  mkdirSync(runsDir, { recursive: true });
  const now = new Date();
  const stamp =
    now.toISOString().slice(0, 10).replace(/-/g, '') +
    '-' +
    now.toISOString().slice(11, 19).replace(/:/g, '');
  const slug = `consult-${sub}-${provider}`;
  const promptFile = join(runsDir, `${stamp}-${slug}-prompt.md`);
  const logFile = join(runsDir, `${stamp}-${slug}.log`);
  const reportFile = join(runsDir, `${stamp}-${slug}-report.md`);
  const latestReportFile = join(gitCtx.root, '.kit', 'consult-report.md');

  writeFileSync(promptFile, promptBundle.fullPrompt);

  const timeoutSecs = parseInt(cfg.CONSULT_TIMEOUT_SECS, 10) || 120;
  const startMs = Date.now();

  try {
    let result;
    if (provider === 'anthropic') {
      result = await callAnthropic({
        apiUrl: cfg.CONSULT_API_URL_ANTHROPIC,
        apiKey,
        model,
        systemInstructions: promptBundle.systemInstructions,
        userPrompt: promptBundle.userPrompt,
        maxOutputTokens,
        timeoutSecs,
      });
    } else if (provider === 'openai') {
      result = await callOpenAI({
        apiUrl: cfg.CONSULT_API_URL_OPENAI,
        apiKey,
        model,
        systemInstructions: promptBundle.systemInstructions,
        userPrompt: promptBundle.userPrompt,
        maxOutputTokens,
        timeoutSecs,
      });
    } else if (provider === 'gemini') {
      result = await callGemini({
        apiBaseUrl: cfg.CONSULT_API_URL_GEMINI,
        apiKey,
        model,
        systemInstructions: promptBundle.systemInstructions,
        userPrompt: promptBundle.userPrompt,
        maxOutputTokens,
        timeoutSecs,
      });
    } else {
      throw new Error(`Unsupported provider: ${provider}`);
    }

    const secs = Math.max(1, Math.round((Date.now() - startMs) / 1000));
    const inTok = result.inputTokens || estInputTokens;
    const outTok = result.outputTokens || Math.ceil(Buffer.byteLength(result.text, 'utf8') / 4);
    const actualCostUsd = estimateCostUsd(model, inTok, outTok);

    if (!result.text) {
      throw new Error('Provider returned an empty response.');
    }

    const formattedReport =
      `<!-- Advisory specialist report from ${provider}/${model} (${sub}). ` +
      `Primary agent: verify all claims and file paths before applying changes, and run kit test. -->${LF}` +
      `${result.text}${LF}`;

    writeFileSync(reportFile, formattedReport);
    writeFileSync(latestReportFile, formattedReport);
    writeFileSync(
      logFile,
      JSON.stringify(
        {
          stamp,
          task: sub,
          provider,
          model,
          authorization: auth.mode,
          duration_secs: secs,
          input_tokens: inTok,
          output_tokens: outTok,
          estimated_cost_usd: actualCostUsd,
        },
        null,
        2
      ) + LF
    );

    if (auth.mode === 'session-scope') {
      incrementScopeUsage(auth.scopePath, auth.scopeData);
    }

    recordUsage({
      stamp,
      gitCtx,
      featureName,
      task: sub,
      provider,
      model,
      secs,
      inputTokens: inTok,
      outputTokens: outTok,
      costUsd: actualCostUsd,
      status: 'ok',
      confDir: cfg._confDir,
    });

    console.log(
      `=== CONSULT ${sub.toUpperCase()} REPORT (${provider}/${model}, ${secs}s, in:${inTok} out:${outTok} tokens, ~$${actualCostUsd.toFixed(4)}) ===`
    );
    console.log(`Saved in: ${reportFile}`);
    console.log(formattedReport.trim());
    console.log('=== END OF CONSULT REPORT ===');
    return 0;
  } catch (err) {
    const secs = Math.max(1, Math.round((Date.now() - startMs) / 1000));
    const safeMsg = redactSecrets(err?.message || String(err));
    writeFileSync(
      logFile,
      `CONSULT FAILED after ${secs}s (${provider}/${model}, task=${sub}):${LF}${safeMsg}${LF}`
    );
    recordUsage({
      stamp,
      gitCtx,
      featureName,
      task: sub,
      provider,
      model,
      secs,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      status: 'failed',
      confDir: cfg._confDir,
    });
    console.error(
      [
        `CONSULT UNAVAILABLE: ${provider}/${model} failed after ${secs}s (${safeMsg}).`,
        `Log saved in: ${logFile}`,
        `Primary agent: report this failure to the owner in one sentence and continue the normal workflow without delegation.`,
      ].join(LF)
    );
    return 4;
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/consult.mjs')) {
  runCli(process.argv.slice(2)).then((code) => process.exit(code));
}
