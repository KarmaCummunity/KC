// supabase/functions/_shared/post-extraction/eval/replay.ts
// Runs the golden set through the real pipeline with a recorded model: deterministic, free and
// offline, so it can gate CI (FR-IMPORT-010 AC2). Only the model is replaced; the scrub, the
// validation, the time resolution and the confidence routing are the production code.

import { extractExternalPost, type ExtractionOutcome } from '../extractPost.ts';
import type { ExtractionLists } from '../domain/validateExtraction.ts';
import type { ExtractionProviderInput, PostExtractionProvider } from '../providerTypes.ts';
import { buildReport } from './metrics.ts';
import type { EvalReport, GoldenCase } from './types.ts';

/** Wednesday 4 Nov 2026, 12:00 in Israel: the "now" of every replayed case without a timestamp. */
export const REPLAY_NOW = new Date('2026-11-04T10:00:00Z');

/** The closed lists the replay offers the model, as the live catalog would. */
export const REPLAY_LISTS: ExtractionLists = {
  worlds: ['items', 'food', 'rides', 'time', 'housing', 'animals', 'knowledge'],
  subcategories: {
    items: ['furniture', 'kitchen', 'clothing', 'books', 'toys', 'baby', 'sport', 'electronics', 'tools', 'other'],
    food: ['cooked', 'fresh', 'packaged', 'frozen', 'dry'],
  },
  detailKeys: {},
};

/** The answer a careful model gives for a case: the labels written back in the contract's shape. */
export function recordedFrom(c: GoldenCase): Record<string, unknown> {
  const e = c.expect;
  if (!e.isPost) return { is_post: false, reject_reason: e.reject ?? 'not_a_post' };
  const isRide = e.world === 'rides';
  const answer: Record<string, unknown> = {
    is_post: true,
    reject_reason: null,
    direction: e.direction ?? 'unknown',
    world_slug: e.world ?? null,
    subcategory: e.sub ?? null,
    title: c.text.split('\n')[0].slice(0, 60),
    description: c.text.slice(0, 400),
    place: { city_text: e.city ?? null, street_text: null, neighborhood_text: null },
    time: c.when ?? { kind: 'none' },
    ride: isRide ? { origin_text: e.origin ?? null, destination_text: e.destination ?? null, meeting_texts: [], seats: null } : null,
    details: {},
    language: 'he',
    confidence: { overall: 0.9, per_field: { direction: 0.9, world: 0.9, title: 0.9 } },
  };
  return { ...answer, ...c.modelWrong };
}

/** A provider that answers each case's text with its recorded answer. */
export function recordedProvider(cases: GoldenCase[], answers: (c: GoldenCase) => unknown = recordedFrom): PostExtractionProvider {
  const byText = new Map(cases.map((c) => [c.id, c]));
  return {
    extract: (input: ExtractionProviderInput) => {
      // The pipeline hands over scrubbed text; each case's text carries a unique id marker for the lookup.
      const id = /\[#(g\d+)\]/.exec(input.text)?.[1];
      const c = id ? byText.get(id) : undefined;
      return c ? Promise.resolve({ raw: answers(c), model: 'recorded' }) : Promise.reject(new Error(`no recording for: ${input.text.slice(0, 40)}`));
    },
  };
}

export interface ReplayResult {
  outcomes: ExtractionOutcome[];
  report: EvalReport;
}

/** The text sent through the pipeline: the message plus a lookup marker that is stripped from nothing real. */
export const withMarker = (c: GoldenCase) => `${c.text} [#${c.id}]`;

export async function replay(cases: GoldenCase[], provider: PostExtractionProvider = recordedProvider(cases)): Promise<ReplayResult> {
  const outcomes: ExtractionOutcome[] = [];
  for (const c of cases) {
    const now = c.sentAt ? new Date(c.sentAt) : REPLAY_NOW;
    outcomes.push(await extractExternalPost(
      { provider, lists: REPLAY_LISTS, now: () => now, resolvePlace: () => Promise.resolve([]) },
      c.sentAt ? withMarker({ ...c, text: `${stamp(c.sentAt)}${c.text}` }) : withMarker(c),
    ));
  }
  return { outcomes, report: buildReport(cases, outcomes) };
}

/** WhatsApp-style prefix carrying the send time, so the pipeline resolves relative words against it. */
function stamp(sentAtIso: string): string {
  const d = new Date(sentAtIso);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('day')}.${get('month')}.${get('year')}, ${get('hour')}:${get('minute')} - Dana: `;
}
