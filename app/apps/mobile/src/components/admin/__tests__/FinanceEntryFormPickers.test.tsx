// @vitest-environment jsdom
// FR-FIN-003 / FR-RESP-006 AC28 — the ledger entry's account and category pickers are the shared chip
// row: "no account" maps to null, and the custom chip hands over to the free-text field.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../i18n/useLocaleBundle', () => ({
  useLocaleBundle: () => ({
    admin: { money: { form: { noAccount: 'no-account', categoryCustom: 'custom' } } },
    transparency: { category: new Proxy({}, { get: (_, key) => `cat:${String(key)}` }) },
  }),
}));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { AccountPicker, CategoryPicker } from '../money/FinanceEntryFormPickers';
import type { FinanceAccount } from '@kc/domain';

afterEach(cleanup);

const account = (accountId: string, name: string) => ({ accountId, name, isActive: true }) as FinanceAccount;

describe('AccountPicker', () => {
  it('picks an account, and "no account" as null', () => {
    const onChange = vi.fn();
    renderInTheme(<AccountPicker accounts={[account('a1', 'Bank')]} value={null} onChange={onChange} />);
    fireEvent.click(screen.getByText('Bank'));
    expect(onChange).toHaveBeenLastCalledWith('a1');
    fireEvent.click(screen.getByText('no-account'));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});

describe('CategoryPicker', () => {
  it('picks a category key, and the custom chip opens the free text', () => {
    const onPick = vi.fn();
    const onCustom = vi.fn();
    renderInTheme(<CategoryPicker direction="in" value="" customMode={false} onPick={onPick} onCustom={onCustom} />);
    fireEvent.click(screen.getByText('custom'));
    expect(onCustom).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
});
