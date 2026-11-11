// @vitest-environment jsdom
// Pre-sign-in language switch (FR-SETTINGS-018 AC7): offers the other language in its own
// script and runs the same persist → change → direction → reload flow as Settings.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Alert } from 'react-native';

const { i18n, persistLanguage, applyLayoutDirection, reloadApp } = vi.hoisted(() => ({
  i18n: { language: 'he', changeLanguage: vi.fn() },
  persistLanguage: vi.fn(),
  applyLayoutDirection: vi.fn(),
  reloadApp: vi.fn(),
}));

vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n }) }));
vi.mock('../../../i18n/language', () => ({ persistLanguage, applyLayoutDirection, reloadApp }));

import { AuthLanguageToggle } from '../AuthLanguageToggle';
import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';

beforeEach(() => {
  vi.clearAllMocks();
  i18n.language = 'he';
  persistLanguage.mockResolvedValue(undefined);
  i18n.changeLanguage.mockResolvedValue(undefined);
});
afterEach(cleanup);

describe('AuthLanguageToggle', () => {
  it('offers English from the Hebrew UI and switches to it', async () => {
    const { getByText, getByTestId } = renderInTheme(<AuthLanguageToggle />);
    expect(getByText('settings.languageScreen.optionEn')).toBeTruthy();

    fireEvent.click(getByTestId('auth-language-toggle'));

    await waitFor(() => expect(reloadApp).toHaveBeenCalledTimes(1));
    expect(persistLanguage).toHaveBeenCalledWith('en');
    expect(i18n.changeLanguage).toHaveBeenCalledWith('en');
    expect(applyLayoutDirection).toHaveBeenCalledWith('en');
  });

  it('offers Hebrew from the English UI', () => {
    i18n.language = 'en';
    const { getByText } = renderInTheme(<AuthLanguageToggle />);
    expect(getByText('settings.languageScreen.optionHe')).toBeTruthy();
  });

  it('alerts and does not reload when the switch fails', async () => {
    const alert = vi.spyOn(Alert, 'alert').mockImplementation(() => {});
    persistLanguage.mockRejectedValue(new Error('storage'));
    const { getByTestId } = renderInTheme(<AuthLanguageToggle />);

    fireEvent.click(getByTestId('auth-language-toggle'));

    await waitFor(() =>
      expect(alert).toHaveBeenCalledWith('general.error', 'settings.languageScreen.saveFailed'),
    );
    expect(reloadApp).not.toHaveBeenCalled();
  });
});
