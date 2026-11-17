// @vitest-environment jsdom
// FR-IMPORT-001 AC2 / FR-IMPORT-007 AC2 — the paste screen: a draft needs text AND the own-post
// confirmation; the result is held for the create form and the form opens, whatever the answer.
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { manualImportDraft } from '@kc/domain';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), execute: vi.fn() }));
vi.mock('expo-router', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('../../services/importComposition', () => ({
  extractExternalPostUseCase: () => ({ execute: mocks.execute }),
}));

import { useImportDraftStore } from '../../store/importDraftStore';
import { useImportPost } from '../useImportPost';

describe('useImportPost', () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.execute.mockReset().mockResolvedValue({ ...manualImportDraft('ok'), importId: 'imp-1' });
    useImportDraftStore.setState({ held: null });
  });

  it('cannot submit without text or without the own-post confirmation', () => {
    const { result } = renderHook(() => useImportPost());
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setText('  '));
    act(() => result.current.setConfirmedOwn(true));
    expect(result.current.canSubmit).toBe(false);
    act(() => result.current.setText('sofa'));
    expect(result.current.canSubmit).toBe(true);
    act(() => result.current.setConfirmedOwn(false));
    expect(result.current.canSubmit).toBe(false);
  });

  it('a submit that is not allowed asks nothing of the server', async () => {
    const { result } = renderHook(() => useImportPost());
    act(() => result.current.setText('sofa'));
    await act(() => result.current.submit());
    expect(mocks.execute).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('extracts as a paste of unknown origin, holds the draft with the text and opens the form', async () => {
    const { result } = renderHook(() => useImportPost());
    act(() => result.current.setText('sofa for free'));
    act(() => result.current.setConfirmedOwn(true));
    await act(() => result.current.submit());
    expect(mocks.execute).toHaveBeenCalledWith({ text: 'sofa for free', channel: 'paste', sourcePlatform: 'unknown' });
    expect(useImportDraftStore.getState().held?.pastedText).toBe('sofa for free');
    expect(useImportDraftStore.getState().held?.draft.importId).toBe('imp-1');
    expect(mocks.replace).toHaveBeenCalledWith('/create?importDraft=1');
    expect(result.current.busy).toBe(false);
  });
});
