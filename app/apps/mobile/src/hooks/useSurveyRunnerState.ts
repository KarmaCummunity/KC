// Survey runner state — debounced save + local answer map.
// FR-SETTINGS-016: optimistic local state with 300ms debounce on save.
import { useState, useEffect, useRef, useCallback } from 'react';
import { hasSurveyAnswerValue, type SurveyBundle, type SurveyAnswerDraft } from '@kc/domain';
import { container } from '../lib/container';
import { loadSurveyDraft, saveSurveyDraft } from '../lib/surveyDraftStorage';

const SURVEY_DRAFT_NS = 'survey';

/** One question's local answer: a rating or a chosen option (KC#1058), plus optional text. */
export type SurveyAnswerEntry = {
  rating: number | null;
  choiceKey: string | null;
  answerText: string | null;
};

type AnswerMap = Record<string, SurveyAnswerEntry>;

const EMPTY_ENTRY: SurveyAnswerEntry = { rating: null, choiceKey: null, answerText: null };

function bundleToAnswerMap(bundle: SurveyBundle): AnswerMap {
  const map: AnswerMap = {};
  for (const q of bundle.questions) {
    map[q.id] = EMPTY_ENTRY;
  }
  for (const a of bundle.answers) {
    map[a.questionId] = { rating: a.rating, choiceKey: a.choiceKey, answerText: a.answerText };
  }
  return map;
}

/** Local drafts saved before single-choice questions existed carry no `choiceKey`. */
function normalizeDraftAnswers(answers: Record<string, Partial<SurveyAnswerEntry>>): AnswerMap {
  const map: AnswerMap = {};
  for (const [qid, a] of Object.entries(answers)) {
    map[qid] = { rating: a.rating ?? null, choiceKey: a.choiceKey ?? null, answerText: a.answerText ?? null };
  }
  return map;
}

// Only answers with a value are sent; text alone cannot be stored server-side.
function answerMapToArray(map: AnswerMap): SurveyAnswerDraft[] {
  return Object.entries(map)
    .filter(([, v]) => hasSurveyAnswerValue(v))
    .map(([questionId, v]) => ({
      questionId,
      rating: v.rating,
      choiceKey: v.choiceKey,
      answerText: v.answerText,
    }));
}

type SurveyRunnerState = {
  activeIndex: number;
  setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
  answers: AnswerMap;
  onAnswerChange: (qid: string, entry: SurveyAnswerEntry) => void;
  saveErrorOpen: boolean;
  setSaveErrorOpen: (open: boolean) => void;
};

export function useSurveyRunnerState(
  bundle: SurveyBundle | null,
  slug: string,
): SurveyRunnerState {
  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<AnswerMap>(() =>
    bundle ? bundleToAnswerMap(bundle) : {},
  );
  const [saveErrorOpen, setSaveErrorOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bundleRef = useRef<SurveyBundle | null>(bundle);
  const hydratedRef = useRef(false);

  // Keep the bundle ref fresh for the debounced save closure.
  useEffect(() => {
    if (bundle) bundleRef.current = bundle;
  }, [bundle]);

  // Hydrate once when the bundle first loads: server answers are the baseline,
  // with any locally-saved in-progress draft overlaid on top so a refresh never
  // reverts to the last server snapshot (FR-SETTINGS-016).
  useEffect(() => {
    if (!bundle || hydratedRef.current) return;
    const server = bundleToAnswerMap(bundle);
    const draft = loadSurveyDraft(SURVEY_DRAFT_NS, slug, bundle.version);
    setAnswers(draft ? { ...server, ...normalizeDraftAnswers(draft.answers) } : server);
    if (draft) {
      setActiveIndex(Math.max(0, Math.min(draft.activeIndex, bundle.questions.length - 1)));
    }
    hydratedRef.current = true;
  }, [bundle, slug]);

  // Mirror every post-hydration edit to localStorage so progress survives a
  // reload even before the 300ms debounced server save fires — and for
  // text-only answers the server cannot store (an answer needs a rating or a choice).
  useEffect(() => {
    if (!bundle || !hydratedRef.current) return;
    saveSurveyDraft(SURVEY_DRAFT_NS, slug, {
      version: bundle.version,
      activeIndex,
      answers,
    });
  }, [bundle, slug, activeIndex, answers]);

  const onAnswerChange = useCallback(
    (qid: string, entry: SurveyAnswerEntry) => {
      setAnswers((prev) => {
        const next = { ...prev, [qid]: entry };

        // Debounced save — only fire if at least one answer has its value.
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          const b = bundleRef.current;
          if (!b) return;
          const drafts = answerMapToArray(next);
          if (drafts.length === 0) return;
          container.saveSurveyAnswers
            .execute({ slug, bundle: b, answers: drafts })
            .catch(() => setSaveErrorOpen(true));
        }, 300);

        return next;
      });
    },
    [slug],
  );

  return {
    activeIndex,
    setActiveIndex,
    answers,
    onAnswerChange,
    saveErrorOpen,
    setSaveErrorOpen,
  };
}
