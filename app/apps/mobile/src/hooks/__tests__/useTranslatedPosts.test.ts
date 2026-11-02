// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const getExec = vi.fn();
const matExec = vi.fn();
vi.mock('../../services/postsComposition', () => ({
  getTranslatedPostsUseCase: () => ({ execute: getExec }),
  materializePostTranslationsUseCase: () => ({ execute: matExec }),
}));
const flagOn = { value: true };
vi.mock('../useFeatureFlag', () => ({ useFeatureFlag: () => flagOn.value }));

import { useTranslatedPosts } from '../useTranslatedPosts';

const post = { postId: 'p1', title: 'Hello', description: null, sourceLanguage: 'en' } as any;
const TITLE_ONLY = ['title'] as const;
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: new QueryClient() }, children);

describe('useTranslatedPosts', () => {
  it('renders a cache hit', async () => {
    getExec.mockResolvedValue({ hits: [{ postId: 'p1', field: 'title', translatedText: 'שלום' }], misses: [] });
    const { result } = renderHook(() => useTranslatedPosts([post], 'he'), { wrapper });
    await waitFor(() => expect(result.current.getTranslatedFields('p1').title).toBe('שלום'));
    expect(result.current.getStatus('p1', 'title')).toBe('hit');
  });

  it('marks a miss translating then leaves source on null materialization', async () => {
    getExec.mockResolvedValue({ hits: [], misses: [{ postId: 'p1', field: 'title', sourceLanguage: 'en', text: 'Hello' }] });
    matExec.mockResolvedValue([]); // skip/failure
    const { result } = renderHook(() => useTranslatedPosts([post], 'he'), { wrapper });
    await waitFor(() => expect(matExec).toHaveBeenCalled());
    await waitFor(() => expect(result.current.getStatus('p1', 'title')).toBe('source'));
  });

  it('only requests the fields in the filter', async () => {
    getExec.mockResolvedValue({ hits: [], misses: [] });
    const both = { postId: 'p2', title: 'Hello', description: 'World', sourceLanguage: 'en' } as any;
    renderHook(() => useTranslatedPosts([both], 'he', TITLE_ONLY), { wrapper });
    await waitFor(() => expect(getExec).toHaveBeenCalled());
    const fieldsArg = getExec.mock.calls[0][0].fields.map((f: any) => f.field);
    expect(fieldsArg).toEqual(['title']); // description excluded by the filter
  });
});

describe('useTranslatedPosts flag off', () => {
  it('does not call translation when ugc_auto_translation is off', async () => {
    flagOn.value = false;
    getExec.mockClear();
    const { result } = renderHook(() => useTranslatedPosts([post], 'he'), { wrapper });
    expect(result.current.getTranslatedFields('p1').title).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect(getExec).not.toHaveBeenCalled();
    flagOn.value = true;
  });
});
