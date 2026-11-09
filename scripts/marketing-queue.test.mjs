import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = join(import.meta.dirname, 'marketing-queue.mjs');
test('catch up across offline merges, skip the marketing PR and retry without losing the cursor', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'lexicue-marketing-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const fixtures = join(cwd, 'merged-prs');
  const env = { ...process.env, PATH: cwd + ':' + process.env.PATH, GH_FIXTURE: fixtures };
  const queue = (...args) => spawnSync(process.execPath, [script, ...args], { cwd, env, encoding: 'utf8' });
  const read = (...args) => {
    const result = queue(...args);
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  writeFileSync(join(cwd, 'gh'), '#!/bin/sh\ncat "$GH_FIXTURE"\n');
  chmodSync(join(cwd, 'gh'), 0o755);
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.invalid');
  git('config', 'commit.gpgsign', 'false');
  const commit = title => {
    git('commit', '--allow-empty', '-qm', title);
    return git('rev-parse', 'HEAD');
  };
  const fetch = () => git('update-ref', 'refs/remotes/origin/main', 'HEAD');
  commit('before installation');
  fetch();
  assert.equal(read().status, 'awaiting-installation');

  git('switch', '-qc', 'install');
  mkdirSync(join(cwd, '.codex/agents'), { recursive: true });
  writeFileSync(join(cwd, '.codex/agents/lexicue-marketing.toml'), 'name = "lexicue_marketing"');
  git('add', '.codex');
  commit('role');
  git('switch', '-q', 'main');
  git('merge', '--no-ff', 'install', '-qm', 'install role on main');
  const base = git('rev-parse', 'HEAD');
  fetch();
  assert.deepEqual(read(), { status: 'idle', base });

  const first = commit('squashed feature');
  commit('rebased feature part one');
  const last = commit('rebased feature part two');
  fetch();
  assert.notEqual(queue().status, 0); // GitHub lookup failed; nothing acknowledged
  const row = (sha, n, branch) => [sha, n, branch, 'skylar-deepmind/LexiCue'].join('\t');
  writeFileSync(fixtures, [row(last, 12, 'feature-two'), row(first, 11, 'feature-one')].join('\n'));
  assert.deepEqual(read(), { status: 'pending', base, target: last, pulls: [{ number: 11, sha: first }, { number: 12, sha: last }] });
  assert.equal(read('ack', base, last).status, 'recorded');
  assert.notEqual(queue('ack', base, last).status, 0);
  assert.deepEqual(read(), { status: 'idle', base: last });

  const own = commit('approved publicity update');
  fetch();
  writeFileSync(fixtures, row(own, 13, 'codex/marketing-update-' + first.slice(0, 12)));
  assert.deepEqual(read(), { status: 'self-only', base: last, target: own, pulls: [] });
  assert.notEqual(queue('ack', last, 'HEAD').status, 0);
  assert.equal(read('ack', last, own).status, 'recorded');
  assert.deepEqual(read(), { status: 'idle', base: own });
});
