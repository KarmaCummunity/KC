#!/usr/bin/env node
// Guard: the required-status-check tables in the SSOT docs must list exactly
// the single required check — the `CI gate` job in ci.yml (D-195) — which
// must exist and depend on every other job in that workflow (including the
// release lane that judges PRs into main).
//
// Why this exists: branch protection on `dev` and `main` enumerates required
// checks by their exact display names (see docs/SSOT/ENVIRONMENTS.md "Dev
// merge gates" and docs/SSOT/RELEASE_CHECKLIST.md "Merge gates"). GitHub
// matches required checks by string. When an agent renames or splits a job,
// the old name silently stops matching — the gate evaporates and auto-merge
// proceeds ungated, with no error anywhere. Likewise a ci.yml job left out of
// the gate's `needs:` can fail without blocking a merge. Only AI agents touch
// this repo, so there is no human reviewer to notice either mistake.
//
// It does NOT read GitHub branch-protection settings (no API token in CI);
// the SSOT tables are the source of truth it validates against.

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LANE_JOBS, OPTIONAL_LANES } from './ci-changes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(__dirname, '..');

const SOURCES = [
  {
    file: 'docs/SSOT/ENVIRONMENTS.md',
    heading: 'Dev merge gates',
  },
  {
    file: 'docs/SSOT/RELEASE_CHECKLIST.md',
    heading: 'Merge gates',
  },
];

// The aggregate check every protected branch must require.
export const GATE = { file: '.github/workflows/ci.yml', workflow: 'CI', job: 'CI gate' };

// Parse a workflow file into { name, jobs: Set<jobName> }. Pure regex by
// indentation (no YAML dep, matching the other guard scripts): the workflow
// name is a column-0 `name:`; a job name is a 4-space-indented `name:` (job
// keys sit at 2 spaces, their props at 4). Step names live under `steps:` at
// 6+ spaces with a leading `-`, so they never match.
export function parseWorkflow(content) {
  const stripValue = (raw) => {
    let v = raw.trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    return v.trim();
  };
  const nameMatch = content.match(/^name:[ \t]*(.+)$/m);
  const name = nameMatch ? stripValue(nameMatch[1]) : null;
  const jobs = new Set();
  const jobNameRe = /^ {4}name:[ \t]*(.+)$/gm;
  let m;
  while ((m = jobNameRe.exec(content)) !== null) {
    jobs.add(stripValue(m[1]));
  }
  return { name, jobs };
}

function loadWorkflows(repoRoot) {
  const dir = join(repoRoot, '.github/workflows');
  const byName = new Map();
  const gateFiles = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue;
    const parsed = parseWorkflow(readFileSync(join(dir, entry), 'utf8'));
    if (parsed.name) byName.set(parsed.name, parsed.jobs);
    if (parsed.jobs.has(GATE.job)) gateFiles.push(`.github/workflows/${entry}`);
  }
  return { byName, gateFiles };
}

// Extract required (workflow, job) pairs from the first markdown table that
// follows the given heading. The Job cell may list more than one backticked
// job name joined by "+" (e.g. the main release guard) — capture each.
export function parseRequiredTable(markdown, heading) {
  const lines = markdown.split('\n');
  const headingIdx = lines.findIndex(
    (l) => l.startsWith('## ') && l.includes(heading),
  );
  if (headingIdx === -1) {
    return { pairs: [], error: `heading "## …${heading}…" not found` };
  }
  // Find the header row of the checks table after the heading.
  let i = headingIdx + 1;
  for (; i < lines.length; i++) {
    if (lines[i].startsWith('## ')) {
      return { pairs: [], error: `no checks table under "${heading}"` };
    }
    const cells = splitRow(lines[i]);
    if (cells.length >= 3 && cells[0] === 'Check' && cells[1] === 'Workflow' && cells[2] === 'Job') {
      break;
    }
  }
  if (i >= lines.length) return { pairs: [], error: `no checks table under "${heading}"` };
  i += 1; // header row
  if (lines[i] && /^\|[\s:-]+\|/.test(lines[i])) i += 1; // separator row

  const pairs = [];
  for (; i < lines.length; i++) {
    const row = lines[i];
    if (!row.trim().startsWith('|')) break;
    const cells = splitRow(row);
    if (cells.length < 3) continue;
    const workflow = cells[1];
    const jobNames = [...cells[2].matchAll(/`([^`]+)`/g)].map((mm) => mm[1].trim());
    for (const job of jobNames) pairs.push({ workflow, job });
  }
  return { pairs, error: null };
}

// Split a workflow into the text above `jobs:` (triggers, permissions, env…)
// and one { id, text } per job, or null without a top-level jobs: block.
// Regex by indentation, like parseWorkflow: job ids sit at 2 spaces. Also
// used by scripts/ci-workflow-diff.mjs to compare a PR's ci.yml with base.
export function splitJobs(content) {
  const jobsAt = content.search(/^jobs:[ \t]*$/m);
  if (jobsAt === -1) return null;
  const body = content.slice(jobsAt);
  const heads = [...body.matchAll(/^ {2}([A-Za-z0-9_-]+):[ \t]*$/gm)];
  const jobs = heads.map((m, i) => ({ id: m[1], text: body.slice(m.index, heads[i + 1]?.index ?? body.length) }));
  return { header: content.slice(0, jobsAt), jobs };
}

// Validate ci.yml: its jobs are exactly `changes`, the gate and the lane jobs
// the change detector plans (LANE_JOBS) — a job outside that set would never
// be judged. The gate must run on `always()` (so a failed or cancelled lane
// still produces a red verdict instead of a skipped, passing one) and list
// every other job in `needs:`. Job keys sit at 4 spaces.
export function checkGateWiring(content) {
  const split = splitJobs(content);
  if (!split) return [`${GATE.file}: no top-level jobs: block`];
  const { jobs } = split;
  const gate = jobs.find((j) => parseWorkflow(`name: x\n${j.text}`).jobs.has(GATE.job));
  if (!gate) return [`${GATE.file}: no job named "${GATE.job}"`];
  const errors = [];
  if (!/^ {4}if:[ \t]*(\$\{\{\s*)?always\(\)(\s*\}\})?[ \t]*$/m.test(gate.text)) {
    errors.push(`${GATE.file}: "${GATE.job}" must use \`if: always()\` so failed lanes still fail the gate`);
  }
  // Optional lanes may exist (and then must be in needs:) but are not required.
  const known = new Set(['changes', gate.id, ...LANE_JOBS, ...OPTIONAL_LANES]);
  const ids = new Set(jobs.map((j) => j.id));
  for (const { id } of jobs) {
    if (!known.has(id)) {
      errors.push(`${GATE.file}: job "${id}" is not a lane the change detector plans (scripts/ci-changes.mjs LANE_JOBS)`);
    }
  }
  for (const id of ['changes', ...LANE_JOBS]) {
    if (!ids.has(id)) errors.push(`${GATE.file}: planned job "${id}" does not exist`);
  }
  const needs = parseNeeds(gate.text);
  for (const { id } of jobs) {
    if (id !== gate.id && !needs.includes(id)) {
      errors.push(`${GATE.file}: job "${id}" is missing from the "${GATE.job}" needs: list — its failure would not block merges`);
    }
  }
  return errors;
}

function parseNeeds(jobText) {
  const inline = jobText.match(/^ {4}needs:[ \t]*\[([^\]]*)\]/m);
  if (inline) return inline[1].split(',').map((n) => n.trim()).filter(Boolean);
  const single = jobText.match(/^ {4}needs:[ \t]*([A-Za-z0-9_-]+)[ \t]*$/m);
  if (single) return [single[1]];
  const block = jobText.match(/^ {4}needs:[ \t]*\n((?: {6}- .+\n?)+)/m);
  return block ? [...block[1].matchAll(/- ([A-Za-z0-9_-]+)/g)].map((m) => m[1]) : [];
}

function splitRow(row) {
  const t = row.trim();
  if (!t.startsWith('|')) return [];
  return t.slice(1, t.endsWith('|') ? -1 : undefined).split('|').map((c) => c.trim());
}

export function checkRequiredChecksDrift({ repoRoot = DEFAULT_REPO_ROOT } = {}) {
  const errors = [];
  let checked = 0;
  let workflows;
  let gateFiles;
  try {
    ({ byName: workflows, gateFiles } = loadWorkflows(repoRoot));
  } catch (err) {
    return { ok: false, errors: [`Could not read workflows: ${err.message}`], checked: 0 };
  }
  // A second job named `CI gate` would satisfy branch protection on its own.
  for (const file of gateFiles.filter((f) => f !== GATE.file)) {
    errors.push(`${file}: defines a job named "${GATE.job}"; only ${GATE.file} may`);
  }

  for (const src of SOURCES) {
    let markdown;
    try {
      markdown = readFileSync(join(repoRoot, src.file), 'utf8');
    } catch (err) {
      errors.push(`Could not read ${src.file}: ${err.message}`);
      continue;
    }
    const { pairs, error } = parseRequiredTable(markdown, src.heading);
    if (error) {
      errors.push(`${src.file}: ${error}`);
      continue;
    }
    if (pairs.length === 0) {
      errors.push(`${src.file}: parsed 0 required checks under "${src.heading}" — table format changed?`);
      continue;
    }
    if (!pairs.some((p) => p.workflow === GATE.workflow && p.job === GATE.job)) {
      errors.push(`${src.file}: required checks under "${src.heading}" must include "${GATE.workflow} / ${GATE.job}".`);
    }
    for (const { workflow, job } of pairs) {
      checked += 1;
      // dev and main (incl. the release lane) both require only the gate; any
      // other required context can hang "Expected" or bypass the lane plan.
      if (workflow !== GATE.workflow || job !== GATE.job) {
        errors.push(`${src.file}: "${workflow} / ${job}" must not be a required check; "${GATE.job}" is the only one (D-195) — make it a ci.yml lane instead.`);
      }
      const jobs = workflows.get(workflow);
      if (!jobs) {
        errors.push(
          `${src.file}: required check references workflow "${workflow}" but no workflow with that name: exists in .github/workflows/.`,
        );
        continue;
      }
      if (!jobs.has(job)) {
        errors.push(
          `${src.file}: required check "${workflow} / ${job}" has no matching job — ` +
            `a job was renamed/removed. Update the doc table AND GitHub branch protection. ` +
            `Jobs in "${workflow}": ${[...jobs].map((j) => `"${j}"`).join(', ')}.`,
        );
      }
    }
  }

  try {
    errors.push(...checkGateWiring(readFileSync(join(repoRoot, GATE.file), 'utf8')));
  } catch (err) {
    errors.push(`Could not read ${GATE.file}: ${err.message}`);
  }

  return { ok: errors.length === 0, errors, checked };
}

function main() {
  const result = checkRequiredChecksDrift();
  if (!result.ok) {
    console.error('✗ Required-checks drift detected:');
    for (const err of result.errors) console.error(`  • ${err}`);
    console.error(
      '\nThe SSOT required-check tables must match real workflow job names.\n' +
        'If you renamed a job: update the table(s) above AND the GitHub branch-protection\n' +
        'required-status-checks list (Settings → Branches → dev/main). Every ci.yml job\n' +
        'must also be listed in the CI gate job\'s needs:.',
    );
    process.exit(1);
  }
  console.log(
    `✓ Required-checks drift guard passed — ${result.checked} documented checks map to real jobs; CI gate wiring OK.`,
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
