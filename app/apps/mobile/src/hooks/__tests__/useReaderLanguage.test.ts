// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const { mockI18n } = vi.hoisted(() => ({ mockI18n: { language: 'he' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: mockI18n }) }));

import { useReaderLanguage } from '../useReaderLanguage';

describe('useReaderLanguage', () => {
  it('returns the app UI language and follows UI language changes', () => {
    mockI18n.language = 'he';
    const { result, rerender } = renderHook(() => useReaderLanguage());
    expect(result.current).toBe('he');

    act(() => {
      mockI18n.language = 'en';
    });
    rerender();
    expect(result.current).toBe('en');
  });
});
