// The dev-push Maestro run (maestro-dev-health.yml) yields to the merge queue (#2613, 24 Nov 2026).
// Since #2690 every merge group into dev that touches the app runs the journeys on its exact head, so
// a dev-push run is a late, redundant signal. When it held the shared emulator concurrency group
// (kc-dev-maestro-emulator) it stalled every merge group behind it: on 24 Nov run 45298826606, for a
// dev commit already superseded, sat ahead of three merge groups for ~70 min.
// A push run therefore gives up its turn (succeeds without running the flows, with a notice) when
//   • dev has moved past the commit it would test (a newer commit, tested or about to be), or
//   • a merge-group Maestro emulator job is waiting or running.
// Only `push` runs on dev yield. Merge groups, PRs (label opt-in) and manual runs never do.
// A failed lookup never yields: the run then behaves exactly as before.

/** Pure. Why a run should yield, or null. `mgEmulatorJobs` = merge-group emulator jobs not yet completed. */
export function yieldReason({ event, ref, sha, devSha, mgEmulatorJobs }) {
  if (event !== 'push' || ref !== 'refs/heads/dev') return null;
  if (devSha && sha && devSha !== sha) return `dev moved on to ${devSha.slice(0, 8)} (this run tests ${sha.slice(0, 8)})`;
  if ((mgEmulatorJobs ?? []).length > 0) {
    return `a merge group is waiting for the emulator (${mgEmulatorJobs.map((j) => j.html_url ?? j.id).join(', ')})`;
  }
  return null;
}

/** Emulator jobs of merge-group CI runs that have not completed. Pure over the API shapes. */
export function pendingEmulatorJobs(runJobs) {
  return runJobs.flat().filter((j) => /android emulator/.test(j.name ?? '') && j.status !== 'completed');
}

/** Reads the inputs from the API with `gh(path)` (contents: read + actions: read). */
export async function readYieldInputs(gh, repo) {
  const ref = await gh(`/repos/${repo}/git/ref/heads/dev`);
  const runs = await gh(`/repos/${repo}/actions/workflows/ci.yml/runs?event=merge_group&per_page=30`);
  const active = (runs.workflow_runs ?? []).filter((r) => r.status !== 'completed');
  const jobs = [];
  for (const run of active) jobs.push((await gh(`/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`)).jobs ?? []);
  return { devSha: ref.object?.sha ?? null, mgEmulatorJobs: pendingEmulatorJobs(jobs) };
}
