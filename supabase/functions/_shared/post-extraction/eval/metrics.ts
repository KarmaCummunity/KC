// supabase/functions/_shared/post-extraction/eval/metrics.ts
// Scoring of one case and of the whole set (FR-IMPORT-010 AC2). Pure, so the gate itself is
// unit-tested: a degraded set must fail it.

import { israelParts } from '../domain/israelTime.ts';
import type { ExtractionOutcome } from '../extractPost.ts';
import {
  THRESHOLDS, type Bucket, type EvalReport, type GoldenCase, type Miss, type MetricName, type Tally,
} from './types.ts';

// Hebrew letters that attach to a place name ("in", "to", "from", "the", "that", "and").
const PREFIX_LETTERS = 'הבלמשו';

/** A place written in a message, comparable with the careful reader's name for it. */
export function placeKey(text: string | null | undefined): string {
  let t = (text ?? '').normalize('NFKC').replace(/[֑-ׇ]/g, '').replace(/["'׳״`.,()]/g, '')
    .replace(/[\s\-–־]+/g, ' ').trim().toLowerCase();
  for (let i = 0; i < 2; i++) if (t.length > 4 && PREFIX_LETTERS.includes(t[0])) t = t.slice(1);
  return t;
}

/** Wall-clock instant in Israel, `YYYY-MM-DDTHH:MM`, the form the labels use. */
export function localIso(at: Date): string {
  const p = israelParts(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

interface CaseScore {
  tallies: Partial<Record<MetricName, boolean>>;
  misses: Miss[];
}

/** Score one outcome against its labels; a metric a case has no label for is not scored. */
export function scoreCase(c: GoldenCase, o: ExtractionOutcome): CaseScore {
  const tallies: Partial<Record<MetricName, boolean>> = {};
  const misses: Miss[] = [];
  const check = (metric: MetricName, ok: boolean, expected: string, got: string) => {
    tallies[metric] = ok;
    if (!ok) misses.push({ id: c.id, metric, expected, got });
  };
  const e = c.expect;
  const x = o.extraction;
  const post = o.reason === 'ok' && x?.isPost === true;
  if (!e.isPost) {
    if (e.reject === 'commercial') check('commercial_recall', !post, 'rejected', post ? 'post' : `${o.reason}`);
    return { tallies, misses };
  }
  if (e.direction) check('direction', post && x!.direction === e.direction, e.direction, post ? x!.direction : o.reason);
  if (e.world) check('world', post && x!.worldSlug === e.world, e.world, post ? String(x!.worldSlug) : o.reason);
  if (e.sub) check('subcategory', post && x!.worldSlug === e.world && x!.subcategory === e.sub, e.sub, post ? String(x!.subcategory) : o.reason);
  if (e.city) check('city', post && placeKey(x!.place.cityText) === placeKey(e.city), e.city, post ? String(x!.place.cityText) : o.reason);
  if (e.origin || e.destination) {
    const ok = post && placeKey(x!.ride?.originText) === placeKey(e.origin) && placeKey(x!.ride?.destinationText) === placeKey(e.destination);
    check('ride_route', ok, `${e.origin} → ${e.destination}`, post ? `${x!.ride?.originText} → ${x!.ride?.destinationText}` : o.reason);
  }
  if (e.at) {
    // A label with only a date is met by the date; a label with a time needs the instant.
    const got = e.at.length === 10 ? o.time?.dateIso ?? 'none' : o.time?.at ? localIso(o.time.at) : 'none';
    check('departure', got === e.at, e.at, got);
  }
  return { tallies, misses };
}

const rate = (t: Tally) => (t.total === 0 ? undefined : t.correct / t.total);

/** F1 of "is a post" over all cases: a post called a non-post and a non-post called a post both cost. */
export function isPostF1(cases: GoldenCase[], outcomes: ExtractionOutcome[]): { f1: number; tally: Tally } {
  let tp = 0, fp = 0, fn = 0, total = 0;
  cases.forEach((c, i) => {
    const o = outcomes[i];
    const said = o.reason === 'ok';
    total++;
    if (c.expect.isPost && said) tp++;
    else if (!c.expect.isPost && said) fp++;
    else if (c.expect.isPost && !said) fn++;
  });
  const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  return { f1, tally: { correct: total - fp - fn, total } };
}

const BUCKET_EDGES = [0, 0.5, 0.85];

/** How often a confidence range is right: the reliability table that tunes the routing thresholds. */
export function calibrate(rows: { confidence: number; right: boolean }[]): Bucket[] {
  return BUCKET_EDGES.map((from, i) => {
    const to = BUCKET_EDGES[i + 1] ?? Infinity;
    const inside = rows.filter((r) => r.confidence >= from && r.confidence < to);
    return { from, cases: inside.length, right: inside.filter((r) => r.right).length };
  });
}

/** Score a whole replayed set. `outcomes[i]` answers `cases[i]`. */
export function buildReport(cases: GoldenCase[], outcomes: ExtractionOutcome[]): EvalReport {
  const tallies: Partial<Record<MetricName, Tally>> = {};
  const misses: Miss[] = [];
  const rows: { confidence: number; right: boolean }[] = [];
  cases.forEach((c, i) => {
    const s = scoreCase(c, outcomes[i]);
    for (const [metric, ok] of Object.entries(s.tallies) as [MetricName, boolean][]) {
      const t = (tallies[metric] ??= { correct: 0, total: 0 });
      t.total++;
      if (ok) t.correct++;
    }
    misses.push(...s.misses);
    rows.push({ confidence: outcomes[i].confidence, right: s.misses.length === 0 });
  });
  const f1 = isPostF1(cases, outcomes);
  tallies.is_post_f1 = f1.tally;
  const rates: Partial<Record<MetricName, number>> = { is_post_f1: f1.f1 };
  for (const [metric, t] of Object.entries(tallies) as [MetricName, Tally][]) {
    if (metric !== 'is_post_f1') rates[metric] = rate(t);
  }
  return { cases: cases.length, rates, tallies, misses, calibration: calibrate(rows) };
}

/** The metrics below their minimum; empty means the gate passes. A metric with nothing to score fails: the set lost coverage. */
export function gateFailures(report: EvalReport): MetricName[] {
  return (Object.keys(THRESHOLDS) as MetricName[]).filter((m) => (report.rates[m] ?? -1) < THRESHOLDS[m]);
}

/** A readable table for the console and the CI log. */
export function formatReport(report: EvalReport): string {
  const lines = [`cases: ${report.cases}`];
  for (const m of Object.keys(THRESHOLDS) as MetricName[]) {
    const r = report.rates[m];
    const t = report.tallies[m];
    lines.push(`${m.padEnd(18)} ${r === undefined ? 'n/a'.padStart(6) : (r * 100).toFixed(1).padStart(5) + '%'}  min ${(THRESHOLDS[m] * 100).toFixed(0)}%  (${t?.correct ?? 0}/${t?.total ?? 0})`);
  }
  lines.push('confidence → share of cases fully right:');
  for (const b of report.calibration) lines.push(`  from ${b.from.toFixed(2)}: ${b.right}/${b.cases}`);
  for (const miss of report.misses.slice(0, 20)) lines.push(`  miss ${miss.id} ${miss.metric}: expected ${miss.expected}, got ${miss.got}`);
  return lines.join('\n');
}
