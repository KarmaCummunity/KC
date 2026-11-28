#!/usr/bin/env node
// A DEV-side catch-up waits without needing another merge or a default-branch cron.
import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CHECKPOINT_WINDOW_SECONDS = 60 * 60;
export function checkpointDecision({ head, versionCommit, versionTime, now }) {
  if (!head || !versionCommit || !Number.isFinite(versionTime)) throw new Error('Cannot resolve VERSION checkpoint');
  if (versionTime > now) throw new Error('VERSION checkpoint is in the future');
  if (head === versionCommit) return { proceed: false, waitSeconds: 0 };
  return { proceed: true, waitSeconds: Math.max(0, versionTime + CHECKPOINT_WINDOW_SECONDS - now) };
}

export async function waitForCheckpoint({ readState, sleep, now = () => Math.floor(Date.now() / 1000) }) {
  let originalCheckpoint;
  for (;;) {
    const state = await readState();
    originalCheckpoint ??= state.versionCommit;
    // A newer checkpoint already covered this waiter. A later merge owns its next waiter.
    if (state.versionCommit !== originalCheckpoint) return false;
    const decision = checkpointDecision({ ...state, now: now() });
    if (!decision.proceed) return false;
    if (decision.waitSeconds === 0) return true;
    await sleep(Math.min(decision.waitSeconds, 60));
  }
}

async function main() {
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
  let checkpoint;
  const proceed = await waitForCheckpoint({
    readState: () => {
      git('fetch', 'origin', 'dev');
      const head = git('rev-parse', 'origin/dev');
      const versionCommit = git('log', '-1', '--format=%H', 'origin/dev', '--', 'app/VERSION');
      checkpoint ??= versionCommit;
      const versionTime = Number(git('show', '-s', '--format=%ct', versionCommit));
      return { head, versionCommit, versionTime };
    },
    sleep: (seconds) => new Promise((done) => setTimeout(done, seconds * 1000)),
  });
  process.stdout.write(proceed ? 'VERSION checkpoint eligible, independent of queue occupancy.\n' : 'No new VERSION checkpoint needed.\n');
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `proceed=${proceed}\ncheckpoint=${checkpoint}\n`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
