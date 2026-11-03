// FR-TRANSLATE-003 — read-time translation overlay for a set of posts. Caller
// passes ONLY the currently-visible posts (viewport-gated) so materialization is
// bounded. Cache hits render inline; eligible misses materialize in the
// background and swap in on the next read. Failed/skipped fields are remembered
// (session skip-map) so they never re-fire.
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  toTranslatableFields,
  deriveTranslationStatus,
  type TranslationStatus,
  type PostWithOwner,
} from '@kc/application';
import { useFeatureFlag } from './useFeatureFlag';
import { getTranslatedPostsUseCase, materializePostTranslationsUseCase } from '../services/postsComposition';

type FieldKey = string; // `${postId}:${field}`
const key = (postId: string, field: string): FieldKey => `${postId}:${field}`;

export interface TranslatedFields {
  title?: string;
  description?: string;
}

// `fields` restricts which translatable fields the overlay materializes (e.g.
// the feed grid renders only the title, so it should not pay for description
// translations). It is a useMemo dependency below, so the caller MUST pass a
// stable (module-scope) constant — never a fresh array per render. Undefined
// means "all fields" (post-detail default).
export function useTranslatedPosts(
  posts: PostWithOwner[],
  readerLanguage: string,
  fields?: readonly ('title' | 'description')[],
) {
  const queryClient = useQueryClient();
  const translationEnabled = useFeatureFlag('ugc_auto_translation');
  const skipRef = useRef<Set<FieldKey>>(new Set());

  const eligible = useMemo(
    () =>
      (translationEnabled ? posts : [])
        .flatMap((p) => toTranslatableFields(p, readerLanguage))
        .filter((f) => !fields || fields.includes(f.field as 'title' | 'description')),
    [posts, readerLanguage, fields, translationEnabled],
  );
  const postIds = useMemo(() => Array.from(new Set(eligible.map((f) => f.postId))), [eligible]);

  const hitsQuery = useQuery({
    queryKey: ['post-translations', readerLanguage, postIds],
    queryFn: () => getTranslatedPostsUseCase().execute({ fields: eligible, targetLanguage: readerLanguage }),
    enabled: postIds.length > 0,
    staleTime: 5 * 60_000,
  });

  const hitMap = useMemo(() => {
    const m = new Map<FieldKey, string>();
    for (const h of hitsQuery.data?.hits ?? []) m.set(key(h.postId, h.field), h.translatedText);
    return m;
  }, [hitsQuery.data]);

  const inFlightRef = useRef<Set<FieldKey>>(new Set());
  useEffect(() => {
    const misses = (hitsQuery.data?.misses ?? []).filter(
      (m) => !hitMap.has(key(m.postId, m.field)) && !skipRef.current.has(key(m.postId, m.field)),
    );
    if (misses.length === 0) return;
    misses.forEach((m) => inFlightRef.current.add(key(m.postId, m.field)));
    let cancelled = false;
    void materializePostTranslationsUseCase()
      .execute({ misses, targetLanguage: readerLanguage })
      .then((produced) => {
        if (cancelled) return;
        const producedKeys = new Set(produced.map((p) => key(p.contentId, p.field)));
        misses.forEach((m) => {
          const k = key(m.postId, m.field);
          inFlightRef.current.delete(k);
          if (!producedKeys.has(k)) skipRef.current.add(k);
        });
        if (produced.length > 0) {
          void queryClient.invalidateQueries({ queryKey: ['post-translations', readerLanguage, postIds] });
        }
      });
    return () => { cancelled = true; };
  }, [hitsQuery.data, hitMap, readerLanguage, postIds, queryClient]);

  const eligibleKeys = useMemo(() => new Set(eligible.map((f) => key(f.postId, f.field))), [eligible]);

  function getTranslatedFields(postId: string): TranslatedFields {
    return {
      title: hitMap.get(key(postId, 'title')),
      description: hitMap.get(key(postId, 'description')),
    };
  }
  function getStatus(postId: string, field: 'title' | 'description'): TranslationStatus {
    const k = key(postId, field);
    return deriveTranslationStatus({
      hasTranslation: hitMap.has(k),
      isEligible: eligibleKeys.has(k),
      inFlight: inFlightRef.current.has(k),
    });
  }
  return { getTranslatedFields, getStatus };
}
