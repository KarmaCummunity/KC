// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';

const linking = vi.hoisted(() => ({ openSettings: vi.fn() }));
vi.mock('react-native', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-native')>();
  return { ...actual, Linking: linking };
});
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { PermissionSettingsNote } from '../PermissionSettingsNote';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

function renderNote(kind: 'camera' | 'mediaLibrary') {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <PermissionSettingsNote kind={kind} />
    </ThemeProvider>,
  );
}

describe('PermissionSettingsNote', () => {
  it('shows a short photos note and opens Settings only when the link is tapped', () => {
    renderNote('mediaLibrary');
    expect(screen.getByTestId('permission-settings-note')).toBeTruthy();
    expect(screen.getByText('mediaAccess.photosBlocked')).toBeTruthy();
    expect(linking.openSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('permission-open-settings'));
    expect(linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it('shows the camera copy when that permission is blocked', () => {
    renderNote('camera');
    expect(screen.getByText('mediaAccess.cameraBlocked')).toBeTruthy();
  });
});
