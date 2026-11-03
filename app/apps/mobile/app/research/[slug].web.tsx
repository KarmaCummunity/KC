// Web-only public research form — FR-RESEARCH-001, FR-RESEARCH-002, FR-RESEARCH-003.
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { container } from '../../src/lib/container';
import { webTextRtl } from '../../src/lib/webRtlStyle';
import { rtlTextAlignStart } from '../../src/lib/rtlTextAlignStart';
import {
  clearSurveyDraft,
  loadSurveyDraft,
  saveSurveyDraft,
} from '../../src/lib/surveyDraftStorage';

const RESEARCH_DRAFT_NS = 'research';
import { ResearchRunner, errorKey, type AnswerEntry } from '../../src/screens/research/ResearchRunner';

const SOURCE_REGEX = /^[a-z0-9_-]{1,32}$/;

function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function persistSrc(slug: string, src: string): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(`kc-research-src-${slug}`, src);
  }
}

function readPersistedSrc(slug: string): string | null {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage.getItem(`kc-research-src-${slug}`);
  }
  return null;
}

function resolveSource(slug: string, rawSrc: string | undefined): string {
  const candidate = rawSrc?.trim() ?? '';
  if (candidate && SOURCE_REGEX.test(candidate)) return candidate;
  const persisted = readPersistedSrc(slug);
  if (persisted && SOURCE_REGEX.test(persisted)) return persisted;
  return 'direct';
}

export default function PublicResearchScreen() {
  const params = useLocalSearchParams<{ slug: string | string[]; src?: string | string[] }>();
  const slug = normalizeRouteParam(params.slug);
  const srcParam = normalizeRouteParam(params.src) || undefined;
  const router = useRouter();
  const styles = useScreenStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();

  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, AnswerEntry>>({});
  const [contactEmail, setContactEmail] = useState('');
  const [contactWindowHe, setContactWindowHe] = useState('');
  const [honeypot, setHoneypot] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const [missingRatingsHint, setMissingRatingsHint] = useState(false);

  const effectiveSrc = resolveSource(slug, srcParam);

  useEffect(() => {
    if (srcParam && SOURCE_REGEX.test(srcParam)) persistSrc(slug, srcParam);
  }, [slug, srcParam]);

  const bundleQuery = useQuery({
    queryKey: ['public-research-bundle', slug] as const,
    queryFn: () => container.loadPublicResearchBundle.execute(slug),
    enabled: Boolean(slug),
  });

  const bundle = bundleQuery.data;
  const draftHydratedRef = useRef(false);

  // Restore an in-progress draft once the live bundle resolves, so refreshing
  // mid-survey doesn't wipe the visitor's answers (FR-RESEARCH-001).
  useEffect(() => {
    if (!bundle || draftHydratedRef.current) return;
    const draft = loadSurveyDraft(RESEARCH_DRAFT_NS, slug, bundle.version);
    if (draft) {
      setAnswers(draft.answers);
      setActiveIndex(Math.max(0, Math.min(draft.activeIndex, bundle.questions.length - 1)));
      setContactEmail(draft.contactEmail ?? '');
      setContactWindowHe(draft.contactWindowHe ?? '');
    }
    draftHydratedRef.current = true;
  }, [bundle, slug]);

  // Persist every post-hydration edit so progress survives a reload.
  useEffect(() => {
    if (!bundle || !draftHydratedRef.current) return;
    saveSurveyDraft(RESEARCH_DRAFT_NS, slug, {
      version: bundle.version,
      activeIndex,
      answers,
      contactEmail,
      contactWindowHe,
    });
  }, [bundle, slug, activeIndex, answers, contactEmail, contactWindowHe]);

  const onAnswerChange = useCallback(
    (qid: string, rating: number | null, text: string | null) => {
      setAnswers((prev) => ({ ...prev, [qid]: { rating, answerText: text } }));
      setMissingRatingsHint(false);
      setSubmitError(null);
    },
    [],
  );

  async function submitAnswers(): Promise<boolean> {
    if (!bundle) return false;
    setSubmitting(true);
    setSubmitError(null);

    const answersArray = bundle.questions.map((q) => ({
      questionId: q.id,
      rating: answers[q.id]?.rating ?? 1,
      answerText: answers[q.id]?.answerText ?? null,
    }));

    try {
      await container.submitPublicResearchResponse.execute({
        slug,
        version: bundle.version,
        source: effectiveSrc,
        answers: answersArray,
        contactEmail: contactEmail.trim() || null,
        contactWindowHe: contactWindowHe.trim() || null,
        honeypot: honeypot || null,
      });
      return true;
    } catch (err) {
      setSubmitError(err);
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAttemptFinish() {
    if (!bundle || submitting) return;
    const firstUnrated = bundle.questions.findIndex(
      (q) => (answers[q.id]?.rating ?? null) === null,
    );
    if (firstUnrated >= 0) {
      setActiveIndex(firstUnrated);
      setMissingRatingsHint(true);
      return;
    }
    const ok = await submitAnswers();
    if (ok) {
      clearSurveyDraft(RESEARCH_DRAFT_NS, slug);
      router.replace('/research/thanks');
    }
  }

  function renderBody() {
    if (bundleQuery.isLoading) {
      return (
        <View style={styles.centered}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={styles.loadingText}>{t('research.loading')}</Text>
        </View>
      );
    }
    if (bundleQuery.isError || !bundle || bundle.questions.length === 0) {
      return (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{t(errorKey(bundleQuery.error))}</Text>
        </View>
      );
    }
    return (
      <ResearchRunner
        bundle={bundle}
        activeIndex={activeIndex}
        setActiveIndex={setActiveIndex}
        answers={answers}
        onAnswerChange={onAnswerChange}
        contactEmail={contactEmail}
        contactWindowHe={contactWindowHe}
        setContactEmail={setContactEmail}
        setContactWindowHe={setContactWindowHe}
        onAttemptFinish={handleAttemptFinish}
        submitting={submitting}
        submitError={submitError}
        onRetry={() => setSubmitError(null)}
        missingRatingsHint={missingRatingsHint}
      />
    );
  }

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <input
        type="text"
        name="company_website"
        autoComplete="off"
        tabIndex={-1}
        aria-hidden
        style={{ position: 'absolute', left: -9999, height: 0, width: 0, opacity: 0 }}
        value={honeypot}
        onChange={(e) => setHoneypot(e.target.value)}
      />

      {submitError ? (
        <View style={styles.stickyError}>
          <Text style={styles.stickyErrorText}>{t(errorKey(submitError))}</Text>
          <Pressable onPress={() => setSubmitError(null)} accessibilityRole="button">
            <Text style={styles.stickyErrorDismiss}>{t('research.thankYouModal.dismiss')}</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.runnerArea}>{renderBody()}</View>
    </View>
  );
}

const useScreenStyles = makeUseStyles(({ colors }) => ({
  screen: { flex: 1 },
  runnerArea: { flex: 1, minHeight: 0 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
    ...webTextRtl,
  },
  errorText: {
    ...typography.body,
    color: colors.error,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  stickyError: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: 10,
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error,
    gap: spacing.xs,
  },
  stickyErrorText: {
    ...typography.bodySmall,
    color: colors.error,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
  stickyErrorDismiss: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
}));
