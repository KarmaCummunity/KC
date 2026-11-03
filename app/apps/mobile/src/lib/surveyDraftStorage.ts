// surveyDraftStorage — persists an in-progress survey submission to
// localStorage so a browser refresh / accidental reload never wipes the
// answers the user is mid-way through entering. Shared by both survey
// surfaces (FR-RESEARCH-001 public web form · FR-SETTINGS-016 in-app runner).
//
// Web-only: every entry point no-ops cleanly where window/localStorage is
// unavailable (native, SSR, tests). The draft is keyed by `namespace` + survey
// slug and tagged with the bundle version, so a republished survey (new
// question set) never restores answers keyed to old question ids. Drafts
// untouched for longer than the TTL are treated as abandoned and ignored.
//
// `namespace` keeps the two surfaces' drafts isolated:
//   'research' → kc-research-draft-<slug>  (public anonymous Survey B)
//   'survey'   → kc-survey-draft-<slug>    (in-app authenticated Survey A)

// `choiceKey` is set for single-choice questions (KC#1058); drafts saved before it lack the field.
export type SurveyDraftAnswer = {
  rating: number | null;
  choiceKey?: string | null;
  answerText: string | null;
};

export type SurveyDraft = {
  version: number;
  activeIndex: number;
  answers: Record<string, SurveyDraftAnswer>;
  // Research-only contact opt-in fields; absent for the in-app survey.
  contactEmail?: string;
  contactWindowHe?: string;
  savedAt: number;
};

export type SurveyDraftInput = Omit<SurveyDraft, 'savedAt'>;

const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage ?? null;
  } catch {
    // Safari private mode and some embedded webviews throw on access.
    return null;
  }
}

function keyFor(namespace: string, slug: string): string {
  return `kc-${namespace}-draft-${slug}`;
}

function isAnswerMap(value: unknown): value is Record<string, SurveyDraftAnswer> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function loadSurveyDraft(
  namespace: string,
  slug: string,
  version: number,
  now: number = Date.now(),
): SurveyDraft | null {
  const store = storage();
  if (!store || !slug) return null;
  try {
    const raw = store.getItem(keyFor(namespace, slug));
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<SurveyDraft> | null;
    if (!draft || typeof draft !== 'object') return null;
    if (draft.version !== version) return null; // stale question set — discard
    if (!isAnswerMap(draft.answers)) return null;
    if (typeof draft.savedAt === 'number' && now - draft.savedAt > DRAFT_TTL_MS) {
      return null; // abandoned
    }
    return {
      version,
      activeIndex: typeof draft.activeIndex === 'number' ? draft.activeIndex : 0,
      answers: draft.answers,
      contactEmail: typeof draft.contactEmail === 'string' ? draft.contactEmail : undefined,
      contactWindowHe: typeof draft.contactWindowHe === 'string' ? draft.contactWindowHe : undefined,
      savedAt: typeof draft.savedAt === 'number' ? draft.savedAt : now,
    };
  } catch {
    return null;
  }
}

export function saveSurveyDraft(
  namespace: string,
  slug: string,
  draft: SurveyDraftInput,
  now: number = Date.now(),
): void {
  const store = storage();
  if (!store || !slug) return;
  try {
    store.setItem(keyFor(namespace, slug), JSON.stringify({ ...draft, savedAt: now }));
  } catch {
    // Quota / private-mode write failures are non-fatal: the visitor keeps
    // their in-memory session, just without the refresh safety net.
  }
}

export function clearSurveyDraft(namespace: string, slug: string): void {
  const store = storage();
  if (!store || !slug) return;
  try {
    store.removeItem(keyFor(namespace, slug));
  } catch {
    // ignore
  }
}
