import { israelLocalToUtc } from './israelTime';

/** FR-IMPORT-002 AC1: input is cut at this many characters after trimming. */
export const IMPORT_MAX_INPUT_CHARS = 4000;

export interface NormalizedMessage {
  readonly text: string;
  /** WhatsApp send time parsed from a pasted "[date, time] Name:" prefix; null when there is none. */
  readonly messageAt: Date | null;
  readonly truncated: boolean;
}

// Niqqud / cantillation marks and bidi controls: invisible, and they break fuzzy matching.
const HEBREW_MARKS = /[\u0591-\u05C7]/g;
const BIDI_CONTROLS = /[\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

const DATE = String.raw`(\d{1,2})[./](\d{1,2})[./](\d{2,4})`;
const TIME = String.raw`(\d{1,2}):(\d{2})`;
const SENDER = String.raw`[^:\n]{1,60}:\s*`;
// Android: "4.11.2026, 12:03 - Name: ", iOS: "[4.11.2026, 12:03:45] Name: " or "[12:03, 4.11.2026] Name: ".
const PREFIXES: ReadonlyArray<{ re: RegExp; order: 'dateFirst' | 'timeFirst' }> = [
  { re: new RegExp(String.raw`^${DATE},?\s+${TIME}\s+-\s+${SENDER}`), order: 'dateFirst' },
  { re: new RegExp(String.raw`^\[${DATE},?\s+${TIME}(?::\d{2})?\]\s*${SENDER}`), order: 'dateFirst' },
  { re: new RegExp(String.raw`^\[${TIME}(?::\d{2})?,?\s+${DATE}\]\s*${SENDER}`), order: 'timeFirst' },
];

// Whole-line artefacts that carry no post content. The Hebrew alternatives are written as escapes
// (source files hold no Hebrew text): "media not included", "this message was edited",
// "image omitted", "forwarded".
const SYSTEM_LINE =
  /^(?:<?This message was edited>?|<?Media omitted>?|<?\u05D4\u05DE\u05D3\u05D9\u05D4 \u05DC\u05D0 \u05E0\u05DB\u05DC\u05DC\u05D4>?|\u05D4\u05D5\u05D3\u05E2\u05D4 \u05D6\u05D5 \u05E0\u05E2\u05E8\u05DB\u05D4|\u05D4\u05EA\u05DE\u05D5\u05E0\u05D4 \u05D4\u05D5\u05E9\u05DE\u05D8\u05D4|\u05D4\u05D5\u05E2\u05D1\u05E8|Forwarded)$/i;

/** Parse the first-line WhatsApp prefix into (timestamp, rest). Israeli date order: day.month.year. */
function takeTimestampPrefix(text: string): { rest: string; at: Date | null } {
  for (const { re, order } of PREFIXES) {
    const m = re.exec(text);
    if (!m) continue;
    const g = m.slice(1).map(Number);
    const [h, min, d, mo, y] = order === 'dateFirst'
      ? [g[3]!, g[4]!, g[0]!, g[1]!, g[2]!]
      : [g[0]!, g[1]!, g[2]!, g[3]!, g[4]!];
    return { rest: text.slice(m[0].length), at: israelLocalToUtc(y < 100 ? 2000 + y : y, mo, d, h, min) };
  }
  return { rest: text, at: null };
}

/**
 * Deterministic cleanup before the PII scrub and any model call (FR-IMPORT-002 AC1-AC2):
 * NFKC, niqqud and bidi marks out, WhatsApp prefix → timestamp, system lines out, whitespace
 * collapsed (blank-line structure kept), then the length cap.
 */
export function normalizeMessage(raw: string): NormalizedMessage {
  const folded = raw.normalize('NFKC').replace(BIDI_CONTROLS, '').replace(HEBREW_MARKS, '').trim();
  const { rest, at } = takeTimestampPrefix(folded);
  const text = rest
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter((line) => !SYSTEM_LINE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  const truncated = text.length > IMPORT_MAX_INPUT_CHARS;
  return { text: truncated ? text.slice(0, IMPORT_MAX_INPUT_CHARS) : text, messageAt: at, truncated };
}
