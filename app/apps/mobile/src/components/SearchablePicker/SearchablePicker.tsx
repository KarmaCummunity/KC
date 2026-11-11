// Generic searchable picker. Used by CityPicker + StreetPicker so the
// two surfaces are guaranteed visually + behaviorally identical (PM
// requirement 2026-05-18). All non-trivial logic lives in
// `searchablePickerLogic.ts` (unit tested); the component is the JSX shell.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, Text } from '@kc/ui';
import { BottomSheet, TextField } from '../ui';
import { ErrorBoundary } from '../ErrorBoundary';
import {
  filterItems,
  freeTextSelection,
  shouldShowFreeTextRow,
  type SearchablePickerItemDescriptor,
} from './searchablePickerLogic';
import { useSearchablePickerStyles } from './searchablePickerStyles';
import { KcFlashList } from '../lists/KcFlashList';

export interface SearchablePickerProps<T> {
  readonly title: string;
  readonly placeholder: string;
  readonly value: SearchablePickerItemDescriptor | null;
  readonly items: readonly T[] | null;
  readonly isLoading: boolean;
  readonly error: unknown;
  readonly disabled?: boolean;
  readonly disabledHelperText?: string;
  readonly onDisabledPress?: () => void;
  readonly onSelect: (selection: SearchablePickerItemDescriptor) => void;
  readonly matchItem: (item: T, query: string) => boolean;
  readonly renderRow: (item: T) => SearchablePickerItemDescriptor;
  readonly allowFreeText?: boolean;
  readonly emptyText?: string;
  readonly errorText?: string;
  /** When set, error state shows a retry control (e.g. refetch streets). */
  readonly onErrorRetry?: () => void;
}

export function SearchablePicker<T>(props: SearchablePickerProps<T>) {
  const {
    title,
    placeholder,
    value,
    items,
    isLoading,
    error,
    disabled,
    disabledHelperText,
    onDisabledPress,
    onSelect,
    matchItem,
    renderRow,
    allowFreeText,
    emptyText,
    errorText,
    onErrorRetry,
  } = props;
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useSearchablePickerStyles();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const searchInputRef = useRef<React.ComponentRef<typeof TextField>>(null);

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      try {
        searchInputRef.current?.focus();
      } catch {
        // Safe focus attempt
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [open]);

  const filtered = useMemo<readonly T[]>(
    () => filterItems(items, query, matchItem),
    [items, query, matchItem],
  );

  const showFreeTextRow = useMemo(
    () => shouldShowFreeTextRow({ allowFreeText, query, items, renderRow }),
    [allowFreeText, query, items, renderRow],
  );

  const handleFieldPress = useCallback(() => {
    if (disabled) {
      onDisabledPress?.();
      return;
    }
    setOpen(true);
  }, [disabled, onDisabledPress]);

  const closeModal = useCallback(() => {
    setOpen(false);
    setQuery('');
  }, []);

  const handleRowPress = useCallback(
    (selection: SearchablePickerItemDescriptor) => {
      onSelect(selection);
      closeModal();
    },
    [onSelect, closeModal],
  );

  const handleFreeTextPress = useCallback(() => {
    handleRowPress(freeTextSelection(query));
  }, [handleRowPress, query]);

  const resolvedEmptyText = emptyText ?? t('profile.cityPickerEmpty');
  const resolvedErrorText = errorText ?? t('profile.cityPickerError');
  const trimmedQuery = query.trim();

  return (
    <>
      <TouchableOpacity
        style={[styles.field, disabled ? styles.fieldDisabled : null]}
        onPress={handleFieldPress}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ disabled: !!disabled }}
      >
        <Text style={[styles.value, !value?.name ? styles.valuePlaceholder : null]}>
          {value?.name ? value.name : title}
        </Text>
      </TouchableOpacity>
      {disabled && disabledHelperText ? (
        <Text style={styles.disabledHelper}>{disabledHelperText}</Text>
      ) : null}

      <BottomSheet
        visible={open}
        onDismiss={closeModal}
        title={title}
        closeAccessibilityLabel={t('profile.cityPickerCloseA11y')}
        scrollable={false}
        maxHeight="70%"
      >
        <ErrorBoundary
          boundary="searchable-picker"
          fallback={({ onRetry }) => (
            <View style={styles.errorBlock}>
              <Text style={styles.errorText}>{resolvedErrorText}</Text>
              <TouchableOpacity
                style={styles.retryButton}
                onPress={onRetry}
                accessibilityRole="button"
                accessibilityLabel={t('general.retry')}
              >
                <Text style={styles.retryLabel}>{t('general.retry')}</Text>
              </TouchableOpacity>
            </View>
          )}
        >
          <View style={styles.sheetContent}>
            <TextField
              ref={searchInputRef}
              label={placeholder}
              containerStyle={styles.search}
              placeholder={placeholder}
              value={query}
              onChangeText={setQuery}
              autoCorrect={false}
              autoCapitalize="none"
            />
            {isLoading ? (
              <View style={styles.statusRow}>
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : error != null ? (
              <View style={styles.errorBlock}>
                <Text style={styles.errorText}>{resolvedErrorText}</Text>
                {onErrorRetry ? (
                  <TouchableOpacity
                    style={styles.retryButton}
                    onPress={onErrorRetry}
                    accessibilityRole="button"
                    accessibilityLabel={t('general.retry')}
                  >
                    <Text style={styles.retryLabel}>{t('general.retry')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : (
              <KcFlashList
                data={filtered as T[]}
                keyExtractor={(item, idx) => {
                  try {
                    const row = renderRow(item);
                    return `${row?.id ?? idx}-${idx}`;
                  } catch {
                    return String(idx);
                  }
                }}
                keyboardShouldPersistTaps="handled"
                ListHeaderComponent={
                  showFreeTextRow ? (
                    <TouchableOpacity
                      style={[styles.row, styles.freeTextRow]}
                      onPress={handleFreeTextPress}
                      accessibilityRole="button"
                    >
                      <Text style={styles.freeTextLabel}>
                        {t('profile.streetPickerUseMyText', { value: trimmedQuery })}
                      </Text>
                    </TouchableOpacity>
                  ) : null
                }
                ListEmptyComponent={
                  !showFreeTextRow ? <Text style={styles.emptyText}>{resolvedEmptyText}</Text> : null
                }
                renderItem={({ item }) => {
                  let row: SearchablePickerItemDescriptor | null = null;
                  try {
                    row = renderRow(item);
                  } catch {
                    return null;
                  }
                  if (!row || !row.name) return null;
                  return (
                    <TouchableOpacity
                      style={styles.row}
                      onPress={() => handleRowPress(row)}
                      accessibilityRole="button"
                    >
                      <Text style={styles.rowText}>{row.name}</Text>
                    </TouchableOpacity>
                  );
                }}
              />
            )}
          </View>
        </ErrorBoundary>
      </BottomSheet>
    </>
  );
}
