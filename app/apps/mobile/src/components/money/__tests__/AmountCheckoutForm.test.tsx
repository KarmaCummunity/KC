// @vitest-environment jsdom
// Donation / standing-order amount form on the kit (spec 17 §4.1.1, TD-243): presets fill the
// amount, the confirm waits for a valid amount, and it shows a spinner while the payment runs.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { act, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../ui/Screen', () => ({ Screen: ({ children }: { children: React.ReactNode }) => children }));
const payments = vi.hoisted(() => ({ external: false, openExternal: vi.fn() }));
vi.mock('../../../hooks/useExternalDonations', () => ({ useExternalDonations: () => payments }));

import {
  AmountCheckoutForm,
  AmountCheckoutScreen,
  MIN_AMOUNT_ILS,
  parseAmountIls,
  type AmountCheckoutFormProps,
} from '../AmountCheckoutForm';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';

afterEach(() => {
  cleanup();
  payments.external = false;
});

function renderForm(overrides: Partial<AmountCheckoutFormProps> = {}) {
  const onSubmit = overrides.onSubmit ?? vi.fn(() => Promise.resolve());
  const view = renderInTheme(
    <AmountCheckoutForm
      amountLabel="Amount"
      initialAmount="72"
      presets={[36, 72]}
      note="Sandbox"
      submitLabel="Donate"
      ready
      {...overrides}
      onSubmit={onSubmit}
    />,
  );
  return { ...view, onSubmit, submit: () => view.getByRole('button', { name: 'Donate' }) };
}

describe('parseAmountIls', () => {
  it('reads a decimal comma and rejects text', () => {
    expect(parseAmountIls('12,5')).toBe(12.5);
    expect(Number.isNaN(parseAmountIls('abc'))).toBe(true);
  });
});

describe('AmountCheckoutForm', () => {
  it('marks the preset that matches the typed amount and fills the amount from a preset', () => {
    const { getByRole, getByLabelText } = renderForm();
    expect(getByRole('checkbox', { name: '₪72' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(getByRole('checkbox', { name: '₪36' }));
    expect((getByLabelText('Amount') as HTMLInputElement).value).toBe('36');
  });

  it(`blocks the confirm below ₪${MIN_AMOUNT_ILS} and while the screen is not ready`, () => {
    const { submit, getByLabelText, onSubmit } = renderForm();
    fireEvent.change(getByLabelText('Amount'), { target: { value: '4' } });
    expect(submit().getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
    cleanup();

    const notReady = renderForm({ ready: false });
    expect(notReady.submit().getAttribute('aria-disabled')).toBe('true');
  });

  it('submits the parsed amount and stays busy until the payment settles', async () => {
    let settle: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => { settle = resolve; }));
    const { submit, getByLabelText } = renderForm({ onSubmit });
    fireEvent.change(getByLabelText('Amount'), { target: { value: '100,5' } });
    fireEvent.click(submit());

    expect(onSubmit).toHaveBeenCalledWith(100.5);
    expect(submit().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);

    await act(async () => settle());
    expect(submit().getAttribute('aria-busy')).toBe('false');
  });
});

describe('AmountCheckoutScreen', () => {
  const screen = (orgId: string | undefined) => (
    <AmountCheckoutScreen kind="donate" orgId={orgId} amountLabel="Amount" initialAmount="72" submitLabel="Donate" onSubmit={vi.fn()} />
  );

  it('shows the external-provider notice instead of the form while in-app payments are off', () => {
    payments.external = true;
    const { getByTestId, queryByRole } = renderInTheme(screen('org_1'));
    expect(getByTestId('external-donation-notice')).toBeTruthy();
    expect(queryByRole('button', { name: 'Donate' })).toBeNull();
  });

  it('keeps the confirm blocked without an organisation', () => {
    const { getByRole } = renderInTheme(screen(undefined));
    expect(getByRole('button', { name: 'Donate' }).getAttribute('aria-disabled')).toBe('true');
  });
});
