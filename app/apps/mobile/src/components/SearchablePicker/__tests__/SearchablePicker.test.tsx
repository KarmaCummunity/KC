// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { ThemeProvider } from '@kc/ui';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@expo/vector-icons', () => ({ Ionicons: () => <span /> }));
vi.mock('../../ui', async () => {
  const ReactModule = await import('react');
  return {
    TextField: ReactModule.forwardRef(({ label, placeholder, value, onChangeText }: {
      label: string; placeholder: string; value: string; onChangeText: (value: string) => void;
    }, ref: React.Ref<HTMLInputElement>) => ReactModule.createElement('input', {
      ref, 'aria-label': label, placeholder, value, onChange: (event: React.ChangeEvent<HTMLInputElement>) => onChangeText(event.target.value),
    })),
    BottomSheet: ({ visible, title, closeAccessibilityLabel, onDismiss, children }: {
      visible: boolean; title: string; closeAccessibilityLabel: string; onDismiss: () => void; children: React.ReactNode;
    }) => visible ? ReactModule.createElement('section', { 'aria-label': title },
      ReactModule.createElement('button', { 'aria-label': closeAccessibilityLabel, onClick: onDismiss }), children) : null,
  };
});
vi.mock('../../lists/KcFlashList', () => ({
  KcFlashList: ({ data, renderItem, ListHeaderComponent, ListEmptyComponent }: {
    data: readonly unknown[]; renderItem: (args: { item: unknown }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode; ListEmptyComponent?: React.ReactNode;
  }) => <div>{ListHeaderComponent}{data.length ? data.map((item, index) => <React.Fragment key={index}>{renderItem({ item })}</React.Fragment>) : ListEmptyComponent}</div>,
}));

import { SearchablePicker } from '../SearchablePicker';

afterEach(cleanup);

describe('SearchablePicker', () => {
  it('opens, filters by typed query, and selects a matching row', () => {
    const onSelect = vi.fn();
    const items = [{ id: 'haifa', name: 'Haifa' }, { id: 'jerusalem', name: 'Jerusalem' }];
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <SearchablePicker<(typeof items)[number]>
          title="Choose a city"
          placeholder="Search cities"
          value={null}
          items={items}
          isLoading={false}
          error={null}
          onSelect={onSelect}
          matchItem={(item, query) => item.name.toLowerCase().includes(query.toLowerCase())}
          renderRow={(item) => item}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose a city' }));
    expect(screen.getByRole('region', { name: 'Choose a city' })).toBeTruthy();
    const search = screen.getByRole('textbox', { name: 'Search cities' });
    fireEvent.change(search, { target: { value: 'ha' } });

    expect(screen.getByText('Haifa')).toBeTruthy();
    expect(screen.queryByText('Jerusalem')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Haifa' }));
    expect(onSelect).toHaveBeenCalledWith({ id: 'haifa', name: 'Haifa' });
    expect(screen.queryByRole('region', { name: 'Choose a city' })).toBeNull();
  });

  it('renders error state with retry button when error is provided, and retries on press', () => {
    const onRetry = vi.fn();
    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <SearchablePicker<{ id: string; name: string }>
          title="Choose a city"
          placeholder="Search cities"
          value={null}
          items={null}
          isLoading={false}
          error={new Error('Network error')}
          errorText="Failed to load items"
          onErrorRetry={onRetry}
          onSelect={vi.fn()}
          matchItem={() => true}
          renderRow={(item) => item}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose a city' }));
    expect(screen.getByText('Failed to load items')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'general.retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('safely handles corrupted/null items in list without crashing', () => {
    const onSelect = vi.fn();
    const corruptedItems = [
      null as unknown as { id: string; name: string },
      undefined as unknown as { id: string; name: string },
      { id: 'tel-aviv', name: 'Tel Aviv' },
    ];

    render(
      <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
        <SearchablePicker<{ id: string; name: string }>
          title="Choose a city"
          placeholder="Search cities"
          value={null}
          items={corruptedItems}
          isLoading={false}
          error={null}
          onSelect={onSelect}
          matchItem={(item, query) => (item?.name ?? '').toLowerCase().includes(query.toLowerCase())}
          renderRow={(item) => item ?? { id: '', name: '' }}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Choose a city' }));
    expect(screen.getByText('Tel Aviv')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Tel Aviv' }));
    expect(onSelect).toHaveBeenCalledWith({ id: 'tel-aviv', name: 'Tel Aviv' });
  });
});
