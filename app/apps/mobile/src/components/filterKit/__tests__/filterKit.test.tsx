// @vitest-environment jsdom
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FilterButton } from '../FilterButton';
import { FilterSearchBar } from '../FilterSearchBar';
import { ChipSelectRow, chipRowOverflows } from '../ChipSelectRow';
import { FilterChipRow } from '../FilterChipRow';
import { FilterSection } from '../FilterSection';
import { SortSection } from '../SortSection';
import { FilterSheetFrame } from '../FilterSheetFrame';

vi.mock('react-native-reanimated', async () => {
  const { View } = await vi.importActual<typeof import('react-native')>('react-native');
  return {
    default: { View },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: () => ({}),
    withSpring: (value: number) => value,
    withTiming: (value: number) => value,
  };
});
vi.mock('expo-haptics', () => ({
  impactAsync: vi.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
vi.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 20, bottom: 34, left: 0, right: 0 }),
}));
vi.mock('../../../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));
vi.mock('../../../hooks/useModalHardwareBack', () => ({ useModalHardwareBack: () => {} }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string) => k,
    i18n: { language: 'en' },
  }),
}));

afterEach(cleanup);

describe('filterKit — FilterButton', () => {
  it('renders without badge when activeCount is 0', () => {
    const onPress = vi.fn();
    render(<FilterButton activeCount={0} onPress={onPress} testID="test-filter-btn" />);
    expect(screen.queryByTestId('filter-button-badge')).toBeNull();
    fireEvent.click(screen.getByTestId('test-filter-btn'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders badge with count when activeCount > 0 and 9+ when > 9', () => {
    const { rerender } = render(<FilterButton activeCount={3} onPress={vi.fn()} />);
    expect(screen.getByText('3')).toBeTruthy();

    rerender(<FilterButton activeCount={12} onPress={vi.fn()} />);
    expect(screen.getByText('9+')).toBeTruthy();
  });

  it('supports variant="boxed" with badge and active count', () => {
    const onPress = vi.fn();
    const { rerender } = render(
      <FilterButton activeCount={2} onPress={onPress} variant="boxed" testID="boxed-btn" />,
    );
    expect(screen.getByTestId('boxed-btn')).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy();
    fireEvent.click(screen.getByTestId('boxed-btn'));
    expect(onPress).toHaveBeenCalledTimes(1);

    rerender(<FilterButton activeCount={0} onPress={onPress} variant="boxed" testID="boxed-btn" />);
    expect(screen.queryByTestId('filter-button-badge')).toBeNull();
  });
});

describe('filterKit — FilterSearchBar', () => {
  it('updates input and handles clear button', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterSearchBar value="" onChangeText={onChange} placeholder="Search test" />,
    );
    expect(screen.getByPlaceholderText('Search test')).toBeTruthy();

    rerender(<FilterSearchBar value="hello" onChangeText={onChange} />);
    const clearBtn = screen.getByLabelText('filters.searchClearA11y');
    expect(clearBtn).toBeTruthy();
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith('');
  });

  it('handles onSubmitEditing and custom onClear', () => {
    const onSubmit = vi.fn();
    const onClear = vi.fn();
    const onChange = vi.fn();
    render(
      <FilterSearchBar
        value="query"
        onChangeText={onChange}
        onSubmitEditing={onSubmit}
        onClear={onClear}
      />,
    );
    const clearBtn = screen.getByLabelText('filters.searchClearA11y');
    fireEvent.click(clearBtn);
    expect(onChange).toHaveBeenCalledWith('');
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});

describe('filterKit — ChipSelectRow', () => {
  it('chipRowOverflows only when chips are wider than the row', () => {
    expect(chipRowOverflows(400, 300)).toBe(true);
    expect(chipRowOverflows(300, 300)).toBe(false);
    expect(chipRowOverflows(300.5, 300)).toBe(false); // rounding noise
    expect(chipRowOverflows(900, 0)).toBe(false); // not measured yet
  });

  it('shows no expand control while the chips fit the row', () => {
    render(
      <ChipSelectRow testID="chip-select">
        <span>A</span>
      </ChipSelectRow>,
    );
    expect(screen.queryByTestId('chip-select-expand')).toBeNull();
  });

  // Regression: the compact row's scroll area resolved to `flex: 0 0 0%` (zero width), hiding every chip.
  it('lets the compact scroll area grow so the chips are not collapsed to zero width', () => {
    render(
      <ChipSelectRow testID="chip-select">
        <span data-testid="chip-a">A</span>
      </ChipSelectRow>,
    );
    const scrollArea = screen.getByTestId('chip-a').parentElement?.parentElement as HTMLElement;
    const style = window.getComputedStyle(scrollArea);
    expect(style.flexGrow).toBe('1');
    expect(style.flexShrink).toBe('1');
  });
});

describe('filterKit — FilterChipRow', () => {
  const options = [
    { value: 'opt1', label: 'Option 1' },
    { value: 'opt2', label: 'Option 2' },
  ];

  it('renders compact row with expand and handles selection', () => {
    const onChange = vi.fn();
    render(
      <FilterChipRow
        options={options}
        value="opt1"
        onChange={onChange}
        showAllChip
        allLabel="All items"
        testID="inline-row"
      />,
    );
    expect(screen.getByText('All items')).toBeTruthy();
    expect(screen.getByTestId('inline-row-opt1')).toBeTruthy();
    expect(screen.getByTestId('inline-row-opt2')).toBeTruthy();

    fireEvent.click(screen.getByTestId('inline-row-opt2'));
    expect(onChange).toHaveBeenCalledWith('opt2');

    fireEvent.click(screen.getByTestId('inline-row-all'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('supports scrollable mode and multiSelect', () => {
    const onChange = vi.fn();
    render(
      <FilterChipRow
        scrollable
        multiSelect
        options={options}
        value={['opt1']}
        onChange={onChange}
        testID="scroll-row"
      />,
    );
    fireEvent.click(screen.getByTestId('scroll-row-opt2'));
    expect(onChange).toHaveBeenCalledWith(['opt1', 'opt2']);
  });
});

describe('filterKit — FilterSection', () => {
  const options = [
    { value: 'cat1', label: 'Category 1' },
    { value: 'cat2', label: 'Category 2' },
  ];

  it('handles single select mode with All chip', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FilterSection
        title="Single Section"
        options={options}
        value={null}
        onChange={onChange}
        testID="single"
      />,
    );
    expect(screen.getByText('Single Section')).toBeTruthy();
    expect(screen.getByTestId('single-all')).toBeTruthy();

    fireEvent.click(screen.getByTestId('single-cat1'));
    expect(onChange).toHaveBeenCalledWith('cat1');

    rerender(
      <FilterSection
        title="Single Section"
        options={options}
        value="cat1"
        onChange={onChange}
        testID="single"
      />,
    );
    fireEvent.click(screen.getByTestId('single-all'));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('handles multi select mode with All chip', () => {
    const onChange = vi.fn();
    render(
      <FilterSection
        title="Multi Section"
        multiSelect
        options={options}
        value={['cat1']}
        onChange={onChange}
        testID="multi"
      />,
    );
    // Toggling already selected option removes it
    fireEvent.click(screen.getByTestId('multi-cat1'));
    expect(onChange).toHaveBeenCalledWith([]);

    // Toggling unselected option adds it
    fireEvent.click(screen.getByTestId('multi-cat2'));
    expect(onChange).toHaveBeenCalledWith(['cat1', 'cat2']);

    // Clicking All chip resets to empty array
    fireEvent.click(screen.getByTestId('multi-all'));
    expect(onChange).toHaveBeenCalledWith([]);
  });
});

describe('filterKit — SortSection', () => {
  it('renders sort options and triggers onChange', () => {
    const onChange = vi.fn();
    render(
      <SortSection
        title="Sort by"
        options={[
          { value: 'newest', label: 'Newest' },
          { value: 'oldest', label: 'Oldest' },
        ]}
        value="newest"
        onChange={onChange}
        testID="sort"
      />,
    );
    expect(screen.getByText('Sort by')).toBeTruthy();
    fireEvent.click(screen.getByTestId('sort-oldest'));
    expect(onChange).toHaveBeenCalledWith('oldest');
  });
});

describe('filterKit — FilterSheetFrame', () => {
  it('renders title, clear button, and optional apply button', () => {
    const onClear = vi.fn();
    const onApply = vi.fn();
    const onDismiss = vi.fn();

    render(
      <FilterSheetFrame
        visible
        title="Filter Frame"
        onDismiss={onDismiss}
        onClear={onClear}
        applyLabel="Apply Now"
        onApply={onApply}
      >
        <div>Content</div>
      </FilterSheetFrame>,
    );

    expect(screen.getByText('Filter Frame')).toBeTruthy();
    expect(screen.getByText('Content')).toBeTruthy();
    expect(screen.getByText('filters.clearAll')).toBeTruthy();
    expect(screen.getByText('Apply Now')).toBeTruthy();

    fireEvent.click(screen.getByText('filters.clearAll'));
    expect(onClear).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByText('Apply Now'));
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
