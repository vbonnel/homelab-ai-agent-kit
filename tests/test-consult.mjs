#!/usr/bin/env node
// Automated test suite for homelab-ai-agent-kit specialist delegation (consult).
// Run with: node --test tests/test-consult.mjs

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {
  mkdtempSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  runCli,
  redactSecrets,
  isForbiddenPath,
} from '../lib/consult.mjs';

const LF = String.fromCharCode(10);
const KIT_DIR = resolve(dirname(new URL(import.meta.url).pathname), '..');

let server;
let baseUrl;
const receivedRequests = [];

before(async () => {
  server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const bodyText = Buffer.concat(chunks).toString('utf8');
    let bodyJson = {};
    try {
      bodyJson = JSON.parse(bodyText);
    } catch {
      // ignore
    }
    receivedRequests.push({
      url: req.url,
      headers: req.headers,
      body: bodyJson,
      rawBody: bodyText,
    });

    if (req.url.includes('/fail500')) {
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Simulated upstream error sk-secretkey1234567890' }));
      return;
    }

    if (req.url.includes('/slow')) {
      await new Promise((r) => setTimeout(r, 2500));
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({}));
      return;
    }

    if (req.url.startsWith('/anthropic')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          content: [
            {
              type: 'text',
              text: ['## Findings', 'None', '', '## Assessment', 'Looks solid.', '', '## Verdict', 'VERDICT: PASS'].join(LF),
            },
          ],
          usage: { input_tokens: 120, output_tokens: 45 },
        })
      );
      return;
    }

    if (req.url.startsWith('/openai')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [
            {
              message: {
                content: [
                  '## Likely Root Cause(s)',
                  'Off-by-one in parser.js:12',
                  '',
                  '## How to Verify',
                  'Run kit test',
                  '',
                  '## Recommended Fix',
                  'Use <= instead of <',
                ].join(LF),
              },
            },
          ],
          usage: { prompt_tokens: 150, completion_tokens: 60 },
        })
      );
      return;
    }

    if (req.url.startsWith('/gemini')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: [
                      '## High-Value Test Cases',
                      '1. Empty input test',
                      '',
                      '## Safety & Isolation Notes',
                      'Uses SQLite in .kit/',
                      '',
                      '## Example Test Code',
                      'assert.equal(1, 1);',
                    ].join(LF),
                  },
                ],
              },
            },
          ],
          usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 50 },
        })
      );
      return;
    }

    res.writeHead(404);
    res.end('Not found');
  });

  await new Promise((resolveListen) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolveListen();
    });
  });
});

after(async () => {
  if (server) {
    await new Promise((r) => server.close(r));
  }
});

function createTempProject(extraLines = []) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-kit-test-'));
  const repoDir = join(dir, 'project');
  const confDir = join(dir, 'config');
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(confDir, { recursive: true });

  execFileSync('git', ['init', '-b', 'main'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.name', 'Test Owner'], { cwd: repoDir });
  execFileSync('git', ['config', 'user.email', 'owner@example.local'], { cwd: repoDir });

  writeFileSync(
    join(repoDir, 'AGENTS.md'),
    ['# AGENTS.md', 'Run scripts/test.sh. Never touch live DB.', ''].join(LF)
  );
  writeFileSync(
    join(repoDir, 'app.js'),
    ['export function add(a, b) {', '  return a + b;', '}', ''].join(LF)
  );
  mkdirSync(join(repoDir, 'specs'), { recursive: true });
  writeFileSync(
    join(repoDir, 'specs', 'math.md'),
    ['# Math feature', 'Status: building', '', '## Goal', 'Add numbers safely.', ''].join(LF)
  );
  writeFileSync(
    join(repoDir, '.env'),
    [
      'ANTHROPIC_API_KEY=sk-ant-testkey1234567890',
      'OPENAI_API_KEY=sk-proj-testkey1234567890',
      'GEMINI_API_KEY=AIzaSyTestKey1234567890123456',
      'DATABASE_URL=postgres://admin:supersecret@db.internal:5432/prod',
      '',
    ].join(LF)
  );
  writeFileSync(join(repoDir, '.env.workcopy'), 'DATABASE_URL=sqlite://.kit/test.db' + LF);
  writeFileSync(join(repoDir, '.gitignore'), ['.env', '.kit/', ''].join(LF));

  execFileSync('git', ['add', 'AGENTS.md', 'app.js', 'specs/math.md', '.env.workcopy', '.gitignore'], {
    cwd: repoDir,
  });
  execFileSync('git', ['commit', '-m', 'Initial commit'], { cwd: repoDir });

  writeFileSync(
    join(repoDir, 'app.js'),
    [
      'export function add(a, b) {',
      '  if (typeof a !== "number") throw new TypeError("num");',
      '  return a + b;',
      '}',
      '',
    ].join(LF)
  );

  const kitConfPath = join(confDir, 'config');
  writeFileSync(
    kitConfPath,
    [
      'CONSULT_PROVIDERS=anthropic,openai,gemini',
      'CONSULT_DEFAULT_PROVIDER=gemini',
      `CONSULT_API_URL_ANTHROPIC=${baseUrl}/anthropic`,
      `CONSULT_API_URL_OPENAI=${baseUrl}/openai`,
      `CONSULT_API_URL_GEMINI=${baseUrl}/gemini`,
      ...extraLines,
      '',
    ].join(LF)
  );

  return { dir, repoDir, confDir, kitConfPath };
}

test('1. Secret redaction and forbidden path guards block .env, keys, DBs, and full codemap', () => {
  assert.ok(isForbiddenPath('.env'));
  assert.ok(isForbiddenPath('.env.production'));
  assert.equal(isForbiddenPath('.env.workcopy'), null);
  assert.equal(isForbiddenPath('.env.example'), null);
  assert.ok(isForbiddenPath('certs/server.pem'));
  assert.ok(isForbiddenPath('data/app.sqlite3'));
  assert.ok(isForbiddenPath('../outside.txt'));
  assert.ok(isForbiddenPath('codebase.md', 'codebase.md', false));
  assert.equal(isForbiddenPath('codebase.md', 'codebase.md', true), null);

  const dirty = [
    'Key1: sk-ant-api03-abcdef1234567890',
    'Key2: sk-proj-abcdef1234567890',
    'Key3: AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz',
    'DB: postgres://user:my_pass123@10.0.0.5:5432/mydb',
    'STRIPE_SECRET=live_999888777',
  ].join(LF);
  const clean = redactSecrets(dirty);
  assert.ok(!clean.includes('abcdef1234567890'));
  assert.ok(!clean.includes('AIzaSyAbCdEfGhIjKlMnOpQrStUvWxYz'));
  assert.ok(!clean.includes('my_pass123'));
  assert.ok(!clean.includes('live_999888777'));
});

test('2. External API calls are blocked by default without --authorized-once or active scope', async () => {
  const { dir, repoDir, kitConfPath } = createTempProject();
  try {
    const beforeCount = receivedRequests.length;
    const rc = await runCli(['review', '--diff'], {
      kitDir: KIT_DIR,
      kitConfPath,
      cwd: repoDir,
    });
    assert.equal(rc, 3);
    assert.equal(receivedRequests.length, beforeCount, 'No HTTP call should occur when unauthorized');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('3. One-off authorized delegations work across Anthropic, OpenAI, and Gemini and scrub secrets', async () => {
  const { dir, repoDir, kitConfPath } = createTempProject();
  try {
    writeFileSync(
      join(repoDir, 'config-sample.js'),
      ['const fallback = "sk-proj-leakedSecretToken987654321";', 'export default fallback;', ''].join(LF)
    );

    let rc = await runCli(
      [
        'review',
        '--authorized-once',
        '--provider',
        'anthropic',
        '--feature',
        'math',
        '--file',
        'config-sample.js:1-2',
        '--diff',
      ],
      { kitDir: KIT_DIR, kitConfPath, cwd: repoDir }
    );
    assert.equal(rc, 0);
    const anthReq = receivedRequests.at(-1);
    assert.ok(anthReq.url.startsWith('/anthropic'));
    assert.equal(anthReq.headers['x-api-key'], 'sk-ant-testkey1234567890');
    assert.ok(!anthReq.rawBody.includes('leakedSecretToken987654321'), 'Secret must be redacted in payload');
    assert.ok(anthReq.rawBody.includes('sk-[REDACTED]'));

    rc = await runCli(
      [
        'investigate',
        '--authorized-once',
        '--provider',
        'openai',
        '--file',
        'app.js',
        '--question',
        'Why does add throw on string numbers?',
      ],
      { kitDir: KIT_DIR, kitConfPath, cwd: repoDir }
    );
    assert.equal(rc, 0);
    const oaReq = receivedRequests.at(-1);
    assert.ok(oaReq.url.startsWith('/openai'));
    assert.equal(oaReq.headers.authorization, 'Bearer sk-proj-testkey1234567890');

    rc = await runCli(
      [
        'tests',
        '--authorized-once',
        '--orchestrator',
        'claude',
        '--file',
        'app.js',
        '--question',
        'Suggest edge case tests',
      ],
      { kitDir: KIT_DIR, kitConfPath, cwd: repoDir }
    );
    assert.equal(rc, 0);
    const gemReq = receivedRequests.at(-1);
    assert.ok(gemReq.url.startsWith('/gemini/gemini-2.5-pro:generateContent'));
    assert.equal(gemReq.headers['x-goog-api-key'], 'AIzaSyTestKey1234567890123456');

    const usageTsv = readFileSync(join(repoDir, '.kit', 'runs', 'usage.tsv'), 'utf8');
    assert.ok(usageTsv.includes('consult:review:anthropic:claude-sonnet-4-5'));
    assert.ok(usageTsv.includes('consult:investigate:openai:gpt-5'));
    assert.ok(usageTsv.includes('consult:tests:gemini:gemini-2.5-pro'));
    assert.ok(existsSync(join(repoDir, '.kit', 'consult-report.md')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('4. Session scope enable, filtering, call limit enforcement, and disable', async () => {
  const { dir, repoDir, kitConfPath } = createTempProject();
  try {
    let rc = await runCli(
      ['scope', 'enable', '--providers', 'gemini', '--tasks', 'review', '--max-calls', '2', '--ttl', '1h'],
      { kitDir: KIT_DIR, kitConfPath, cwd: repoDir }
    );
    assert.equal(rc, 0);

    rc = await runCli(['review', '--provider', 'anthropic', '--diff'], {
      kitDir: KIT_DIR,
      kitConfPath,
      cwd: repoDir,
    });
    assert.equal(rc, 3);

    rc = await runCli(['review', '--provider', 'gemini', '--diff'], {
      kitDir: KIT_DIR,
      kitConfPath,
      cwd: repoDir,
    });
    assert.equal(rc, 0);

    rc = await runCli(['review', '--provider', 'gemini', '--diff'], {
      kitDir: KIT_DIR,
      kitConfPath,
      cwd: repoDir,
    });
    assert.equal(rc, 0);

    rc = await runCli(['review', '--provider', 'gemini', '--diff'], {
      kitDir: KIT_DIR,
      kitConfPath,
      cwd: repoDir,
    });
    assert.equal(rc, 3);

    rc = await runCli(['scope', 'disable'], {
      kitDir: KIT_DIR,
      kitConfPath,
      cwd: repoDir,
    });
    assert.equal(rc, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('5. Refuses reading .env via --file and enforces model allowlist, cost limits, and graceful failure', async () => {
  const { dir, repoDir, kitConfPath } = createTempProject(['CONSULT_TIMEOUT_SECS=1']);
  try {
    let rc = await runCli(
      ['ask', '--authorized-once', '--provider', 'gemini', '--file', '.env', '--question', 'check'],
      { kitDir: KIT_DIR, kitConfPath, cwd: repoDir }
    );
    assert.equal(rc, 2);

    rc = await runCli(
      ['ask', '--authorized-once', '--provider', 'openai', '--model', 'gpt-unapproved-99', '--file', 'app.js', '--question', 'check'],
      { kitDir: KIT_DIR, kitConfPath, cwd: repoDir }
    );
    assert.equal(rc, 2);

    const failConf = join(dir, 'config-fail');
    writeFileSync(
      failConf,
      readFileSync(kitConfPath, 'utf8') + LF + `CONSULT_API_URL_OPENAI=${baseUrl}/fail500` + LF
    );
    rc = await runCli(
      ['ask', '--authorized-once', '--provider', 'openai', '--file', 'app.js', '--question', 'test 500'],
      { kitDir: KIT_DIR, kitConfPath: failConf, cwd: repoDir }
    );
    assert.equal(rc, 4);

    const slowConf = join(dir, 'config-slow');
    writeFileSync(
      slowConf,
      readFileSync(kitConfPath, 'utf8') + LF + `CONSULT_API_URL_OPENAI=${baseUrl}/slow` + LF
    );
    rc = await runCli(
      ['ask', '--authorized-once', '--provider', 'openai', '--file', 'app.js', '--question', 'test timeout'],
      { kitDir: KIT_DIR, kitConfPath: slowConf, cwd: repoDir }
    );
    assert.equal(rc, 4);

    const tightCostConf = join(dir, 'config-cost');
    writeFileSync(
      tightCostConf,
      readFileSync(kitConfPath, 'utf8') + LF + 'CONSULT_MAX_COST_CALL_USD=0.00001' + LF
    );
    rc = await runCli(
      ['ask', '--authorized-once', '--provider', 'anthropic', '--file', 'app.js', '--question', 'test budget'],
      { kitDir: KIT_DIR, kitConfPath: tightCostConf, cwd: repoDir }
    );
    assert.equal(rc, 5);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('6. Non-destructive install.sh --quick preserves existing user settings and credentials', () => {
  const fakeHome = mkdtempSync(join(tmpdir(), 'agent-kit-home-'));
  try {
    const confDir = join(fakeHome, '.config', 'agent-kit');
    const claudeDir = join(fakeHome, '.claude');
    mkdirSync(confDir, { recursive: true });
    mkdirSync(claudeDir, { recursive: true });

    writeFileSync(
      join(confDir, 'config'),
      [
        '# Custom user config',
        'LUNA_MODEL=my-custom-luna',
        'DOCS_PORT=9999',
        'CONSULT_DEFAULT_PROVIDER=anthropic',
        '',
      ].join(LF)
    );
    writeFileSync(
      join(confDir, 'secrets.env'),
      'ANTHROPIC_API_KEY=sk-ant-preserved-key' + LF
    );
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify(
        {
          model: 'sonnet',
          permissions: {
            allow: ['Bash(my-custom-tool *)'],
          },
        },
        null,
        2
      )
    );

    execFileSync('bash', [join(KIT_DIR, 'install.sh'), '--quick'], {
      env: { ...process.env, HOME: fakeHome },
      stdio: 'pipe',
    });

    const updatedConfig = readFileSync(join(confDir, 'config'), 'utf8');
    assert.ok(updatedConfig.includes('LUNA_MODEL=my-custom-luna'));
    assert.ok(updatedConfig.includes('DOCS_PORT=9999'));
    assert.ok(updatedConfig.includes('CONSULT_DEFAULT_PROVIDER=anthropic'));
    assert.ok(!updatedConfig.includes('CONSULT_DEFAULT_PROVIDER=gemini'));
    assert.ok(updatedConfig.includes('CONSULT_PROVIDERS=anthropic,openai,gemini'));
    assert.ok(updatedConfig.includes('CONSULT_TIMEOUT_SECS=120'));

    const secretsContent = readFileSync(join(confDir, 'secrets.env'), 'utf8');
    assert.equal(secretsContent, 'ANTHROPIC_API_KEY=sk-ant-preserved-key' + LF);

    const mergedSettings = JSON.parse(readFileSync(join(claudeDir, 'settings.json'), 'utf8'));
    assert.equal(mergedSettings.model, 'sonnet');
    assert.ok(mergedSettings.permissions.allow.includes('Bash(my-custom-tool *)'));
    assert.ok(mergedSettings.permissions.allow.includes('Bash(consult review *)'));
    assert.ok(mergedSettings.permissions.deny.includes('Read(**/secrets.env)'));

    assert.ok(existsSync(join(claudeDir, 'skills', 'consult', 'SKILL.md')));
    assert.ok(existsSync(join(fakeHome, '.codex', 'AGENTS.md')));
  } finally {
    rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('7. kit version command and flags (--version, -v, version)', () => {
  const kitBin = join(KIT_DIR, 'bin', 'kit');
  for (const flag of ['--version', '-v', 'version']) {
    const out = execFileSync('bash', [kitBin, flag], { encoding: 'utf8' }).trim();
    assert.match(out, /^kit version [a-f0-9]+ \d{4}-\d{2}-\d{2}$/);
  }
});

