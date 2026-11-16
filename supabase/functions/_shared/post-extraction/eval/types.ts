// supabase/functions/_shared/post-extraction/eval/types.ts
// Shapes of the extraction quality harness (FR-IMPORT-010, ADR-008).

/** The model's relative time exactly as it would write it (the contract's `time` object). */
export interface RecordedTime {
  kind: 'relative_day' | 'weekday' | 'date' | 'recurring';
  day_offset?: number;
  weekday?: number;
  month?: number;
  day_of_month?: number;
  time_hhmm?: string;
  time_period?: 'morning' | 'afternoon' | 'evening' | 'night';
  recurring_weekdays?: number[];
}

/** What a careful reader knows about a message: the labels the pipeline is scored against. */
export interface Expected {
  isPost: boolean;
  /** Why a non-post is not publishable, when it is not. */
  reject?: 'not_a_post' | 'commercial' | 'forbidden';
  direction?: 'offer' | 'request';
  world?: string;
  /** Sub-category slug of that world. */
  sub?: string;
  /** The city as a careful reader would name it (prefix letters and quotes aside). */
  city?: string;
  origin?: string;
  destination?: string;
  /** The resolved instant in Israel local time, `YYYY-MM-DDTHH:MM`; absent when the text gives none. */
  at?: string;
}

/** One hand-labelled message. Messages are rewritten, never copied from real groups. */
export interface GoldenCase {
  id: string;
  text: string;
  /** When the message was sent (ISO, UTC); the replay clock when absent. */
  sentAt?: string;
  expect: Expected;
  /** The relative time the recorded model wrote for this message. */
  when?: RecordedTime;
  /** Fields the recorded model got wrong, replacing the correct recorded value (contract keys). */
  modelWrong?: Record<string, unknown>;
}

export type MetricName =
  | 'is_post_f1' | 'commercial_recall' | 'direction' | 'world' | 'subcategory' | 'city' | 'ride_route' | 'departure';

/** The minimums of FR-IMPORT-010 AC2. */
export const THRESHOLDS: Record<MetricName, number> = {
  is_post_f1: 0.95,
  commercial_recall: 0.95,
  direction: 0.95,
  world: 0.9,
  subcategory: 0.85,
  city: 0.9,
  ride_route: 0.85,
  departure: 0.9,
};

export interface Tally { correct: number; total: number }

export interface Miss {
  id: string;
  metric: MetricName;
  expected: string;
  got: string;
}

export interface Bucket {
  /** Lower bound of the confidence range, inclusive. */
  from: number;
  cases: number;
  /** Cases whose every scored field was right. */
  right: number;
}

export interface EvalReport {
  cases: number;
  /** Rate per metric; a metric with nothing to score is absent. */
  rates: Partial<Record<MetricName, number>>;
  tallies: Partial<Record<MetricName, Tally>>;
  misses: Miss[];
  calibration: Bucket[];
}
