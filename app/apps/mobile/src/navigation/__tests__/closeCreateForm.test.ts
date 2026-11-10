// FR-POST-001 AC9 / FR-POST-006 AC4: the create form returns to the screen it opened over.
import { describe, expect, it, vi } from 'vitest';
import { CREATE_FORM_CLOSE_FALLBACK, closeCreateForm } from '../closeCreateForm';

function routerWith(canGoBack: boolean) {
  return { back: vi.fn(), canGoBack: () => canGoBack, dismissTo: vi.fn() };
}

describe('closeCreateForm', () => {
  it('goes back to the screen underneath the form', () => {
    const router = routerWith(true);
    closeCreateForm(router);
    expect(router.back).toHaveBeenCalledOnce();
    expect(router.dismissTo).not.toHaveBeenCalled();
  });

  it('falls back to home when the form has nothing underneath (deep link / reload)', () => {
    const router = routerWith(false);
    closeCreateForm(router);
    expect(router.back).not.toHaveBeenCalled();
    expect(router.dismissTo).toHaveBeenCalledWith(CREATE_FORM_CLOSE_FALLBACK);
  });
});
