// Admin list filters — `FilterButton` in the TopBar (FR-FEED-004 pattern) plus an
// optional `FilterSearchBar` strip under the bar; sheet body stays on the screen tree.
import React, { useMemo, type ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing } from '@kc/ui';
import { useAdminPortalChrome } from './AdminPortalChrome';
import { FilterButton } from '../filterKit/FilterButton';
import { FilterSearchBar, type FilterSearchBarProps } from '../filterKit/FilterSearchBar';
import { FilterSheetFrame } from '../filterKit/FilterSheetFrame';

export interface AdminSearchFilterToolbarProps {
  readonly portalTitle?: ReactNode;
  readonly headerRightExtra?: ReactNode;
  readonly headerRightStyle?: StyleProp<ViewStyle>;
  readonly search?: Omit<FilterSearchBarProps, 'style' | 'inputRowStyle'>;
  readonly activeFilterCount: number;
  readonly filterVisible: boolean;
  readonly onOpenFilters: () => void;
  readonly onCloseFilters: () => void;
  readonly onClearFilters: () => void;
  readonly filterSheetContent: ReactNode;
  readonly filterButtonTestID?: string;
}

export function AdminSearchFilterToolbar({
  portalTitle,
  headerRightExtra,
  headerRightStyle,
  search,
  activeFilterCount,
  filterVisible,
  onOpenFilters,
  onCloseFilters,
  onClearFilters,
  filterSheetContent,
  filterButtonTestID = 'admin-filter-button',
}: AdminSearchFilterToolbarProps) {
  const styles = useStripStyles();
  const headerRightStyles = useHeaderRightStyles();
  const { t } = useTranslation();

  const headerRight = useMemo(
    () => (
      <View style={[headerRightStyles.row, headerRightStyle]}>
        {headerRightExtra}
        <FilterButton
          variant="icon"
          activeCount={activeFilterCount}
          onPress={onOpenFilters}
          testID={filterButtonTestID}
        />
      </View>
    ),
    [activeFilterCount, filterButtonTestID, headerRightExtra, headerRightStyle, headerRightStyles.row, onOpenFilters],
  );

  const filterStrip = useMemo(() => {
    if (!search) return undefined;
    return (
      <View style={styles.strip}>
        <FilterSearchBar
          {...search}
          style={styles.searchWrap}
          inputRowStyle={styles.searchInputRow}
        />
      </View>
    );
  }, [search, styles.searchInputRow, styles.searchWrap, styles.strip]);

  useAdminPortalChrome({ title: portalTitle, headerRight, filterStrip });

  return (
    <FilterSheetFrame
      visible={filterVisible}
      onDismiss={onCloseFilters}
      title={t('filters.header')}
      onClear={() => {
        onClearFilters();
        onCloseFilters();
      }}
    >
      {filterSheetContent}
    </FilterSheetFrame>
  );
}

export interface AdminFilterTopBarButtonProps {
  readonly portalTitle?: ReactNode;
  /** Extra actions before the filter icon (e.g. “New task”). */
  readonly headerRightExtra?: ReactNode;
  readonly headerRightStyle?: StyleProp<ViewStyle>;
  readonly activeFilterCount: number;
  readonly filterVisible: boolean;
  readonly onOpenFilters: () => void;
  readonly onCloseFilters: () => void;
  readonly onClearFilters: () => void;
  readonly filterSheetContent: ReactNode;
  readonly sheetTitle: string;
  readonly filterButtonTestID?: string;
}

/** Filter-only admin lists (no search field) — button in the TopBar, sheet in the tree. */
export function AdminFilterTopBarButton({
  portalTitle,
  headerRightExtra,
  headerRightStyle,
  activeFilterCount,
  filterVisible,
  onOpenFilters,
  onCloseFilters,
  onClearFilters,
  filterSheetContent,
  sheetTitle,
  filterButtonTestID = 'admin-filter-button',
}: AdminFilterTopBarButtonProps) {
  const styles = useHeaderRightStyles();
  const headerRight = useMemo(
    () => (
      <View style={[styles.row, headerRightStyle]}>
        {headerRightExtra}
        <FilterButton
          variant="icon"
          activeCount={activeFilterCount}
          onPress={onOpenFilters}
          testID={filterButtonTestID}
        />
      </View>
    ),
    [activeFilterCount, filterButtonTestID, headerRightExtra, headerRightStyle, onOpenFilters, styles.row],
  );

  useAdminPortalChrome({ title: portalTitle, headerRight });

  return (
    <FilterSheetFrame
      visible={filterVisible}
      onDismiss={onCloseFilters}
      title={sheetTitle}
      onClear={() => {
        onClearFilters();
        onCloseFilters();
      }}
    >
      {filterSheetContent}
    </FilterSheetFrame>
  );
}

export { FilterSheetFrame as AdminFilterSheetFrame };

const useHeaderRightStyles = makeUseStyles(() => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.xs,
  },
}));

const useStripStyles = makeUseStyles(({ colors }) => ({
  strip: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  searchWrap: { marginBottom: 0 },
  searchInputRow: {
    height: 52,
    borderRadius: radius.xl,
    paddingHorizontal: spacing.base,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
  },
}));
