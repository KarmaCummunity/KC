// supabase/functions/_shared/post-extraction/eval/live.ts
// Runs the golden set against the REAL model and reports how well it does (FR-IMPORT-010 AC2):
//
//   GEMINI_API_KEY=... deno run --allow-env --allow-net --allow-read \
//     supabase/functions/_shared/post-extraction/eval/live.ts [--limit N] [--record answers.json]
//
// It needs a key, so CI never runs it; run it on demand and on a schedule. Exit code 1 when a
// metric is below its minimum. `--record` saves the model's raw answers by case id, to look at
// the misses or to replace the recorded answers of the replay.

import { providerFromEnv } from '../provider.ts';
import { readEnv } from '../../readEnv.ts';
import { GOLDEN_CASES } from './golden.ts';
import { formatReport, gateFailures } from './metrics.ts';
import { replay } from './replay.ts';
import type { ExtractionProviderInput, PostExtractionProvider } from '../providerTypes.ts';
import type { EvalReport, GoldenCase } from './types.ts';

export interface LiveOptions {
  limit: number | null;
  /** Pause between calls: the free tier rate-limits bursts. */
  delayMs: number;
}

export interface LiveResult {
  report: EvalReport;
  /** The model's raw answer per case id. */
  answers: Record<string, unknown>;
  failing: string[];
}

/** Wraps a provider so each answer is kept under its case id and calls are spaced out. */
function recording(inner: PostExtractionProvider, answers: Record<string, unknown>, delayMs: number, sleep: (ms: number) => Promise<void>): PostExtractionProvider {
  return {
    extract: async (input: ExtractionProviderInput) => {
      await sleep(delayMs);
      const result = await inner.extract(input);
      const id = /\[#(g\d+)\]/.exec(input.text)?.[1];
      if (id) answers[id] = result.raw;
      return result;
    },
  };
}

export async function runLive(
  provider: PostExtractionProvider,
  options: LiveOptions,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
  cases: readonly GoldenCase[] = GOLDEN_CASES,
): Promise<LiveResult> {
  const answers: Record<string, unknown> = {};
  const chosen = options.limit ? cases.slice(0, options.limit) : [...cases];
  const { report } = await replay(chosen, recording(provider, answers, options.delayMs, sleep));
  return { report, answers, failing: gateFailures(report) };
}

/** `--limit N` and `--record file`; anything else is an error, so a typo does not run the whole set. */
export function parseArgs(args: string[]): { limit: number | null; record: string | null } {
  let limit: number | null = null;
  let record: string | null = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') limit = Number.parseInt(args[++i] ?? '', 10);
    else if (args[i] === '--record') record = args[++i] ?? null;
    else throw new Error(`unknown argument '${args[i]}'`);
  }
  if (limit !== null && !(limit > 0)) throw new Error('--limit needs a positive number');
  return { limit, record };
}

if (import.meta.main) {
  const { limit, record } = parseArgs(Deno.args);
  const delayMs = Number.parseInt(readEnv('EVAL_DELAY_MS', '700'), 10);
  const result = await runLive(providerFromEnv(), { limit, delayMs });
  console.log(formatReport(result.report));
  if (record) await Deno.writeTextFile(record, JSON.stringify(result.answers, null, 1));
  if (result.failing.length > 0) {
    console.error(`below the minimum: ${result.failing.join(', ')}`);
    Deno.exit(1);
  }
}
