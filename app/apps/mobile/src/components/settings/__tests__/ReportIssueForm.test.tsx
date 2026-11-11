// @vitest-environment jsdom
// #2096 (FR-MOD-002 AC1, FR-RESP-006 AC21): the report-a-problem form — category chips toggle,
// the description field leaves its direction to the shared TextField (no forced physical edge),
// the 500-character cap is on the input, and the minimum-length message appears while too short.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { SUPPORT_ISSUE_DESCRIPTION_MAX } from '@kc/application';

vi.mock('react-native-reanimated', async () => (await import('../../ui/__tests__/kitDialogTestKit')).reanimatedDouble);
vi.mock('expo-haptics', async () => (await import('../../ui/__tests__/kitDialogTestKit')).hapticsDouble);
vi.mock('react-native-safe-area-context', async () => (await import('../../ui/__tests__/kitDialogTestKit')).safeAreaDouble);
vi.mock('react-i18next', async () => (await import('../../ui/__tests__/kitDialogTestKit')).i18nDouble);
vi.mock('@expo/vector-icons', async () => (await import('../../ui/__tests__/kitDialogTestKit')).iconsDouble);

// Records the props the form gives the description field. The alignment bug was a prop
// (`textAlign="left"`), which native inputs honour as a physical edge even under forced RTL.
const fieldProps = vi.hoisted(() => ({ last: {} as Record<string, unknown> }));
vi.mock('../../ui/TextField', () => ({
  TextField: (props: Record<string, unknown>) => {
    fieldProps.last = props;
    const onChangeText = props.onChangeText as (text: string) => void;
    return (
      <input
        data-testid={props.testID as string}
        placeholder={props.placeholder as string}
        value={props.value as string}
        onChange={(e) => onChangeText(e.target.value)}
      />
    );
  },
}));

import { renderInTheme } from '../../ui/__tests__/kitDialogTestKit';
import { ReportIssueForm } from '../ReportIssueForm';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderForm(overrides: Partial<Parameters<typeof ReportIssueForm>[0]> = {}) {
  const props = {
    category: null,
    onCategoryChange: vi.fn(),
    description: '',
    onDescriptionChange: vi.fn(),
    ...overrides,
  };
  renderInTheme(<ReportIssueForm {...props} />);
  return props;
}

describe('ReportIssueForm', () => {
  it('lists the four categories and toggles the chosen one', () => {
    const props = renderForm({ category: 'Bug' });
    for (const cat of ['Bug', 'Account', 'Suggestion', 'Other']) {
      expect(screen.getByTestId(`report-issue-category-${cat}`)).toBeTruthy();
    }
    expect(screen.getByTestId('report-issue-category-Bug').getAttribute('aria-checked')).toBe('true');

    fireEvent.click(screen.getByTestId('report-issue-category-Account'));
    expect(props.onCategoryChange).toHaveBeenLastCalledWith('Account');
    // Tapping the selected chip clears the optional category.
    fireEvent.click(screen.getByTestId('report-issue-category-Bug'));
    expect(props.onCategoryChange).toHaveBeenLastCalledWith(null);
  });

  it('leaves the description direction to TextField and caps it at the maximum', () => {
    renderForm();
    expect(fieldProps.last.textAlign).toBeUndefined();
    expect(fieldProps.last.maxLength).toBe(SUPPORT_ISSUE_DESCRIPTION_MAX);
    expect(fieldProps.last.multiline).toBe(true);
    expect(screen.getByPlaceholderText('settings.reportIssueScreen.descriptionPlaceholder')).toBeTruthy();
  });

  it('passes typed text up unchanged', () => {
    const props = renderForm();
    fireEvent.change(screen.getByTestId('report-issue-description'), { target: { value: 'hello' } });
    expect(props.onDescriptionChange).toHaveBeenCalledWith('hello');
  });

  it('shows the minimum-length message only while the text is too short, with the counter', () => {
    renderForm({ description: 'short' });
    expect(screen.getByText('settings.reportIssueScreen.descriptionMinLength')).toBeTruthy();
    expect(screen.getByText(`5/${SUPPORT_ISSUE_DESCRIPTION_MAX}`)).toBeTruthy();
    cleanup();

    renderForm({ description: '' });
    expect(screen.queryByText('settings.reportIssueScreen.descriptionMinLength')).toBeNull();
    cleanup();

    renderForm({ description: 'long enough now' });
    expect(screen.queryByText('settings.reportIssueScreen.descriptionMinLength')).toBeNull();
  });
});
