// @vitest-environment jsdom
// FR-POST-008 / FR-RESP-006 AC29 — the items edit form marks nothing until a save is rejected, then
// marks each missing part, and every rejected save asks for another jump.
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../i18n', () => ({ default: { t: (key: string) => key } }));

import { useEditPostValidation } from '../useEditPostValidation';

const COMPLETE = {
  isGive: true,
  title: 'Sofa',
  city: { id: 'IL-001', name: 'Lod' },
  street: 'Main',
  streetNumber: '12',
  uploadsLength: 1,
};

describe('useEditPostValidation', () => {
  it('accepts a complete post without marking anything', () => {
    const { result } = renderHook(() => useEditPostValidation(COMPLETE));
    let accepted = false;
    act(() => {
      accepted = result.current.acceptSubmit();
    });
    expect(accepted).toBe(true);
    expect(result.current.failedSubmitCount).toBe(0);
  });

  it('marks nothing before a save, then each missing part, and counts every rejected save', () => {
    const { result, rerender } = renderHook((snapshot) => useEditPostValidation(snapshot), {
      initialProps: { ...COMPLETE, title: '', uploadsLength: 0 },
    });
    expect(result.current.fieldErrors).toEqual({ title: null, photo: null, address: null });

    act(() => void result.current.acceptSubmit());
    expect(result.current.fieldErrors).toMatchObject({ title: 'createPostValidation.missingTitle', photo: 'createPostValidation.missingPhoto' });
    act(() => void result.current.acceptSubmit());
    expect(result.current.failedSubmitCount).toBe(2);

    // A fixed part stops being marked straight away.
    rerender({ ...COMPLETE, uploadsLength: 0 });
    expect(result.current.fieldErrors.title).toBeNull();
    expect(result.current.fieldErrors.photo).toBe('createPostValidation.missingPhoto');
  });
});
