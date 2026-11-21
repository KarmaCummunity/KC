// @vitest-environment jsdom
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
const config = vi.hoisted(() => ({ expoConfig: null as null | { version?: string } }));
vi.mock('expo-constants', () => ({ default: config }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Version' }) }));
import { SettingsVersionFooter } from '../SettingsVersionFooter';
afterEach(cleanup);
function footer() { return render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}><SettingsVersionFooter /></ThemeProvider>); }
describe('SettingsVersionFooter', () => {
  it('renders the marketing version from the current Expo config, not package.json', () => {
    config.expoConfig = { version: ' 1.9.226 ' };
    expect(footer().getByText('Version v1.9.226')).toBeTruthy();
  });
  for (const missing of [null, {}, { version: '' }, { version: '   ' }]) {
    it('does not invent a version when config is ' + JSON.stringify(missing), () => {
      config.expoConfig = missing;
      expect(footer().container.textContent).toBe('');
    });
  }
});

it('wires the footer into the actual Settings screen without the old hard-coded version', () => {
 const source = readFileSync(join(__dirname, '../../../../app/settings.tsx'), 'utf8');
 expect(source).toContain('<SettingsVersionFooter style={styles.version} />');
 expect(source).not.toContain('v0.1.0');
});
