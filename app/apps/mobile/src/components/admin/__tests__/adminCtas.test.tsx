// @vitest-environment jsdom
// CTAs 4 (spec 17 §4.1.1 and §4.3, TD-243): the shared admin actions are compact (`sm`) kit
// buttons — a card's edit / delete pair (the delete a DangerButton, D94), a form's ghost cancel
// and primary submit that keeps its "saving" label while blocked, and a screen header's "new".
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ThemeProvider, lightColors } from '@kc/ui';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

import { AdminCardActions } from '../AdminCardActions';
import { AdminFormActions } from '../AdminFormActions';
import { AdminScreenHeader } from '../AdminScreenHeader';
import { BUTTON_HEIGHT } from '../../ui/buttonStyles';

afterEach(cleanup);

const renderInTheme = (ui: React.ReactElement) =>
  render(<ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>{ui}</ThemeProvider>);

/** jsdom reports colours as `rgb(r, g, b)`; convert a token hex to compare. */
function rgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

describe('AdminCardActions', () => {
  it('renders a compact primary edit and a danger delete that press through', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const { getByRole } = renderInTheme(
      <AdminCardActions editLabel="Edit" deleteLabel="Delete" onEdit={onEdit} onDelete={onDelete} />,
    );
    const edit = getByRole('button', { name: 'Edit' });
    const del = getByRole('button', { name: 'Delete' });
    expect(getComputedStyle(edit).height).toBe(`${BUTTON_HEIGHT.sm}px`);
    expect(getComputedStyle(edit).backgroundColor).toBe(rgb(lightColors.primary));
    expect(getComputedStyle(del).backgroundColor).toBe(rgb(lightColors.error));
    fireEvent.click(edit);
    fireEvent.click(del);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe('AdminFormActions', () => {
  it('submits and cancels when idle', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const { getByRole } = renderInTheme(
      <AdminFormActions cancelLabel="Cancel" submitLabel="Save" submittingLabel="Saving" isPending={false} onCancel={onCancel} onSubmit={onSubmit} />,
    );
    fireEvent.click(getByRole('button', { name: 'Save' }));
    fireEvent.click(getByRole('button', { name: 'Cancel' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('reads "saving", blocks both buttons while pending and shows the error', () => {
    const onSubmit = vi.fn();
    const { getByRole, getByText } = renderInTheme(
      <AdminFormActions cancelLabel="Cancel" submitLabel="Save" submittingLabel="Saving" isPending onCancel={() => {}} onSubmit={onSubmit} errorMsg="Nope" />,
    );
    const submit = getByRole('button', { name: 'Saving' });
    expect(submit.getAttribute('aria-disabled')).toBe('true');
    expect(getByRole('button', { name: 'Cancel' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(getByText('Nope')).toBeTruthy();
  });
});

describe('AdminScreenHeader', () => {
  it('offers the "new" action as a compact primary when a label and handler are given', () => {
    const onNew = vi.fn();
    const { getByRole } = renderInTheme(<AdminScreenHeader title="Tasks" newLabel="New task" onNew={onNew} />);
    const button = getByRole('button', { name: 'New task' });
    expect(getComputedStyle(button).height).toBe(`${BUTTON_HEIGHT.sm}px`);
    fireEvent.click(button);
    expect(onNew).toHaveBeenCalledTimes(1);
  });
});
