#!/usr/bin/env node
/**
 * Whether this run's merge-queue entry still exists (KC#2746). Run by the Maestro emulator job
 * (.github/workflows/ci-maestro-android.yml) as soon as it holds the one emulator slot.
 *
 * When the `dev` merge queue is rebuilt, GitHub deletes the `gh-readonly-queue/…` refs of the old
 * entries but does not cancel their `merge_group` runs. Such an orphaned run can never lead to a
 * merge, yet its emulator job still takes the serial `kc-dev-maestro-emulator` slot for about an
 * hour, ahead of the live entries. With `orphaned=true` the job skips the slot wait and the flows,
 * and frees the emulator in seconds.
 *
 * Only a `404` on the entry's own ref marks it orphaned. Any other event, or any other answer
 * (network error, 5xx, rate limit), counts as live, so a GitHub hiccup never skips a real suite.
 *
 * Output (`$GITHUB_OUTPUT`): `orphaned=true` | `orphaned=false`.
 */
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Prefix of the branch GitHub creates for each merge-queue entry. */
const QUEUE_REF_PREFIX = 'gh-readonly-queue/';

/**
 * Decides the entry's state. `refStatus(ref)` returns the HTTP status of
 * `GET /repos/{repo}/git/ref/heads/{ref}`, or throws when the request itself fails.
 */
export async function entryState({ eventName, refName, refStatus }) {
  if (eventName !== 'merge_group') return { orphaned: false, reason: `not a merge-queue run (${eventName})` };
  if (!refName?.startsWith(QUEUE_REF_PREFIX)) return { orphaned: false, reason: `not a queue ref (${refName})` };
  let status;
  try {
    status = await refStatus(refName);
  } catch (error) {
    return { orphaned: false, reason: `could not read ${refName} (${error.message}); running the suite` };
  }
  if (status === 404) return { orphaned: true, reason: `${refName} no longer exists: the queue dropped this entry` };
  if (status === 200) return { orphaned: false, reason: `${refName} is still queued` };
  return { orphaned: false, reason: `GET ${refName} answered ${status}; running the suite` };
}

/** HTTP status of the entry's ref through the REST API, with the job's read-only token. */
function refStatusFromApi(env) {
  return async (ref) => {
    const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPOSITORY}/git/ref/heads/${ref}`, {
      headers: {
        Authorization: `Bearer ${env.GITHUB_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    return res.status;
  };
}

async function main(env = process.env) {
  const state = await entryState({
    eventName: env.GITHUB_EVENT_NAME,
    refName: env.GITHUB_REF_NAME,
    refStatus: refStatusFromApi(env),
  });
  // A notice on an orphaned run says why its flows did not run; a live run stays quiet.
  console.log(state.orphaned ? `::notice::Orphaned merge-queue run: ${state.reason}` : state.reason);
  if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `orphaned=${state.orphaned}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
