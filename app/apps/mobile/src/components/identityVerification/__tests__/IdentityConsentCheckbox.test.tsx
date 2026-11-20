// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
// Test actual web accessibility translation, not a mock Pressable.
vi.mock('react-native', async () => await vi.importActual('react-native-web'));
vi.mock('@kc/ui', () => ({
  spacing: { sm: 8, md: 12 }, radius: { xs: 2, md: 8 }, typography: {},
  useTheme: () => ({ colors: { surfaceRaised: '#fff', border: '#aaa', text: '#111', primary: '#060' } }),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
vi.mock('../../../lib/rtlLayout', () => ({ layoutWritingDirectionStyle: () => ({}), rowDirectionStart: 'row' }));
vi.mock('../../../lib/rtlTextAlignStart', () => ({ rtlTextAlignStart: 'left' }));
import { IdentityConsentCheckbox } from '../IdentityConsentCheckbox';
afterEach(cleanup);
describe('IdentityConsentCheckbox web accessibility', () => {
  it.each([false, true])('exposes checked=%s and toggles on activation', (checked) => {
    const onToggle = vi.fn();
    render(<IdentityConsentCheckbox checked={checked} label="Biometric consent" onToggle={onToggle} />);
    const checkbox = screen.getByRole('checkbox', { name: 'Biometric consent' });
    expect(checkbox.getAttribute('aria-checked')).toBe(String(checked));
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledExactlyOnceWith(!checked);
  });
});
