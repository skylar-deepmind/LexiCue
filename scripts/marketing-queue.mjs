// Run in any LexiCue worktree after fetching origin/main. The cursor is shared
// by worktrees on this Mac and never needs to be committed or pushed.
import { execFileSync, spawnSync } from 'node:child_process';

const main = 'refs/remotes/origin/main';
const cursor = 'refs/lexicue/marketing-reviewed';
const role = '.codex/agents/lexicue-marketing.toml';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const exists = ref => spawnSync('git', ['rev-parse', '--verify', '--quiet', ref], { stdio: 'ignore' }).status === 0;
const lines = data => data ? data.split('\n') : [];

function activation() {
  return git('log', '--first-parent', '--diff-filter=A', '-1', '--format=%H', main, '--', role);
}

function queuedPulls(base, head) {
  const commits = lines(git('rev-list', '--first-parent', '--reverse', base + '..' + head));
  if (!commits.length) return [];
  // Enumerate merged PRs, including squash and rebase merges, without a search
  // result cap, a wall-clock cutoff, or relying on commit message conventions.
  const jq = '.[] | select(.merged_at != null) | [.merge_commit_sha, (.number | tostring), .head.ref, (.head.repo.full_name // "")] | @tsv';
  const data = execFileSync('gh', ['api', '--paginate',
    'repos/skylar-deepmind/LexiCue/pulls?state=closed&base=main&per_page=100',
    '--jq', jq], { encoding: 'utf8' });
  const byCommit = new Map(lines(data.trimEnd()).map(row => {
    const [sha, number, branch, repo] = row.split('\t');
    return [sha, { sha, number: Number(number), own: repo === 'skylar-deepmind/LexiCue' && /^codex\/marketing-update-[0-9a-f]{12}$/.test(branch) }];
  }));
  return commits.map(sha => byCommit.get(sha)).filter(Boolean);
}

function run([command = 'plan', expectedBase, target]) {
  if (!exists(main)) throw Error('Fetch origin/main first.');
  if (!exists(main + ':' + role)) return { status: 'awaiting-installation' };
  const saved = exists(cursor) ? git('rev-parse', cursor) : null;
  const base = saved ?? activation();
  const head = git('rev-parse', main);
  if (!base || spawnSync('git', ['merge-base', '--is-ancestor', base, head]).status !== 0)
    throw Error('The marketing checkpoint is outside origin/main history. Inspect before continuing.');

  if (command === 'ack') {
    if (expectedBase !== base || !/^[a-f0-9]{40}$/.test(target ?? '') ||
        !lines(git('rev-list', '--first-parent', base + '..' + head)).includes(target))
      throw Error('Stale or invalid marketing checkpoint.');
    git('update-ref', cursor, target, saved ?? '0'.repeat(40));
    return { status: 'recorded', target };
  }
  if (command !== 'plan') throw Error('Use plan or ack BASE TARGET.');
  const merged = queuedPulls(base, head);
  if (!merged.length) return { status: 'idle', base };
  const pulls = merged.filter(pr => !pr.own).map(({ number, sha }) => ({ number, sha }));
  return { status: pulls.length ? 'pending' : 'self-only', base, target: merged.at(-1).sha, pulls };
}

try {
  console.log(JSON.stringify(run(process.argv.slice(2))));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
