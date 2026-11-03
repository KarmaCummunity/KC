// Output of the dependency audit (#1373): plain log lines for every run,
// GitHub annotations for what a reader must act on, and a Markdown step
// summary. Pure functions; the CLI decides where the text goes.

const ALLOWLIST_PATH = 'scripts/check-dependency-audit.allowlist.json';

/**
 * `GHSA-… (high) name@version in a, b`.
 * @param {import('./check-dependency-audit-registry.mjs').Finding} finding
 */
function describe(finding) {
  return `${finding.advisory} (${finding.severity}) ${finding.package}@${finding.version} in ${finding.sources.join(', ')}`;
}

/** Escapes text for a GitHub workflow-command message. */
function escapeCommand(text) {
  return text.replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

/** Escapes text for a Markdown table cell. */
function cell(text) {
  return String(text).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

/**
 * The log lines for one verdict, most urgent first. With `annotate`, lines a
 * reader must act on become `::error::` / `::warning::` workflow commands.
 * @param {ReturnType<typeof import('./check-dependency-audit-policy.mjs').evaluate>} verdict
 * @param {{ unauditable: { specifier: string, source: string }[], sources: string[], annotate: boolean }} context
 * @returns {string[]}
 */
export function renderLog(verdict, { unauditable, sources, annotate }) {
  const error = (text) => (annotate ? `::error title=Dependency audit::${escapeCommand(text)}` : `ERROR ${text}`);
  const warning = (text) => (annotate ? `::warning title=Dependency audit::${escapeCommand(text)}` : `WARN  ${text}`);
  const lockfiles = sources.filter((path) => !path.startsWith('supabase/functions/'));
  const edgeFiles = sources.length - lockfiles.length;
  const lines = [`Audited ${lockfiles.join(', ')} and npm imports in ${edgeFiles} Edge Function files.`];
  for (const finding of verdict.blocking) {
    const expired = finding.expiredException
      ? ` Its exception expired on ${finding.expiredException.expires}; review it again or upgrade.`
      : ` Upgrade it, or add a reviewed exception to ${ALLOWLIST_PATH}.`;
    lines.push(error(`${describe(finding)}: ${finding.title}.${expired}`));
  }
  for (const exception of verdict.stale) {
    lines.push(warning(`Exception ${exception.advisory} for ${exception.package} matches no high/critical finding; remove it from ${ALLOWLIST_PATH}.`));
  }
  for (const item of unauditable) {
    lines.push(warning(`Not auditable (no exact registry version): ${item.specifier} in ${item.source}`));
  }
  for (const finding of verdict.excepted) {
    lines.push(`EXCEPTED ${describe(finding)} until ${finding.exception.expires}`);
  }
  for (const finding of verdict.informational) {
    lines.push(`INFO  ${describe(finding)}: ${finding.title}`);
  }
  lines.push(summaryLine(verdict));
  return lines;
}

/**
 * One closing line with the counts, e.g. `Dependency audit failed: 1 blocking, …`.
 * @param {ReturnType<typeof import('./check-dependency-audit-policy.mjs').evaluate>} verdict
 */
export function summaryLine(verdict) {
  const outcome = verdict.blocking.length > 0 ? 'failed' : 'passed';
  return (
    `Dependency audit ${outcome}: ${verdict.blocking.length} blocking, ` +
    `${verdict.excepted.length} excepted, ${verdict.informational.length} moderate/low, ` +
    `${verdict.stale.length} stale exceptions.`
  );
}

/**
 * The Markdown step summary: a table of blocking and excepted findings, then
 * the stale exceptions. Moderate/low findings appear only as a count.
 * @param {ReturnType<typeof import('./check-dependency-audit-policy.mjs').evaluate>} verdict
 */
export function renderSummary(verdict) {
  const rows = [
    ...verdict.blocking.map((f) => [
      f.expiredException ? `❌ blocking (exception expired ${f.expiredException.expires})` : '❌ blocking',
      f,
    ]),
    ...verdict.excepted.map((f) => [`excepted until ${f.exception.expires}`, f]),
  ];
  const out = ['## Dependency audit', '', summaryLine(verdict), ''];
  if (rows.length > 0) {
    out.push('| Status | Advisory | Severity | Package | Sources |', '|---|---|---|---|---|');
    for (const [status, f] of rows) {
      out.push(`| ${status} | [${f.advisory}](${f.url}) | ${f.severity} | \`${cell(f.package)}@${cell(f.version)}\` | ${cell(f.sources.join(', '))} |`);
    }
    out.push('');
  }
  if (verdict.stale.length > 0) {
    out.push(`Stale exceptions to remove from \`${ALLOWLIST_PATH}\`:`, '');
    for (const e of verdict.stale) out.push(`- ${e.advisory} (${cell(e.package)})`);
    out.push('');
  }
  return out.join('\n');
}
