// Mapped to spec: FR-FEED-020 AC2 — a giving world's header, inside the shared TopBar: the
// world's name is a button that opens and closes the menu of the world's screens (feed, my
// handoffs, my listings, the world's own screens); on the feed, map + filter sit on the right.
import React, { useState } from 'react';
import { Pressable, TouchableOpacity, View } from 'react-native';
import type { Href } from 'expo-router';
import { useRouter } from 'expo-router';
import { useShellTopBarChrome } from '../../navigation/useShellTopBarChrome';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { FilterButton } from '../filterKit/FilterButton';
import { ActionMenuSheet } from '../ui/ActionMenuSheet';
import { SheetActionRow } from '../ui/SheetActionRow';
import type { PostFilterValue } from '../PostFilterSheet';
import { encodeMapFilter } from '../../lib/postMap';
import { worldPostFilterDefaults } from '../../lib/worldPostFeed';
import type { WorldSubScreenLink } from './WorldHubHeader';
import { MY_LISTINGS_PATH, resolveWorldChrome, worldFeedPath } from './worldChromeRegistry';
import { screenLabelKeyForMenuItem } from './worldMenuActive';

interface FeedHeaderOptions {
  readonly worldSlug: string;
  readonly subScreens: readonly WorldSubScreenLink[];
  readonly activeFilterCount: number;
  readonly onOpenFilters: () => void;
  /** The world feed's filter sheet value; the map starts on the same posts (FR-FEED-021). */
  readonly mapFilter?: PostFilterValue;
}

/** Feed screen: title menu plus map and filter on the right. */
export function useWorldHeader({ worldSlug, subScreens, activeFilterCount, onOpenFilters, mapFilter }: FeedHeaderOptions) {
  return useWorldTopBarChrome({
    worldSlug,
    subScreens,
    feedPath: worldFeedPath(worldSlug),
    activeScreenTestId: 'world-menu-feed',
    headerRight: (
      <WorldHeaderActions
        worldSlug={worldSlug}
        activeFilterCount={activeFilterCount}
        onOpenFilters={onOpenFilters}
        mapFilter={mapFilter ?? worldPostFilterDefaults(worldSlug)}
      />
    ),
  });
}

/** Sub-screens (handoffs, my listings, …): same title menu, no feed actions — switch worlds without backing out. */
export function WorldSubScreenChrome({
  worldSlug,
  activeScreenTestId,
  screenTitleKey,
}: Readonly<{ worldSlug: string; activeScreenTestId: string; screenTitleKey?: string }>) {
  const config = resolveWorldChrome(worldSlug);
  const menu = useWorldTopBarChrome({
    worldSlug,
    subScreens: config?.subScreens ?? [],
    feedPath: config?.feedPath ?? worldFeedPath(worldSlug),
    activeScreenTestId,
    screenTitleKey,
    chromeEnabled: Boolean(config),
  });
  if (!config) return null;
  return <>{menu}</>;
}

function useWorldTopBarChrome({
  worldSlug,
  subScreens,
  feedPath,
  activeScreenTestId,
  screenTitleKey,
  headerRight,
  chromeEnabled = true,
}: Readonly<{
  worldSlug: string;
  subScreens: readonly WorldSubScreenLink[];
  feedPath: Href;
  activeScreenTestId: string;
  screenTitleKey?: string;
  headerRight?: React.ReactNode;
  chromeEnabled?: boolean;
}>) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const worldLabel = t(`marketplace.world.${worldSlug}`, { defaultValue: worldSlug });
  const screenLabelKey = screenTitleKey ?? screenLabelKeyForMenuItem(activeScreenTestId, subScreens);
  const topBarLabel = t('donations.worldFeed.topBarTitle', {
    world: worldLabel,
    screen: t(screenLabelKey),
  });

  useShellTopBarChrome(
    chromeEnabled
      ? {
          title: (
            <WorldTitleButton label={topBarLabel} open={menuOpen} onPress={() => setMenuOpen((o) => !o)} />
          ),
          ...(headerRight !== undefined ? { headerRight } : {}),
        }
      : {},
  );

  if (!chromeEnabled) return null;

  return (
    <WorldScreensMenu
      visible={menuOpen}
      onClose={() => setMenuOpen(false)}
      title={worldLabel}
      subScreens={subScreens}
      feedPath={feedPath}
      worldSlug={worldSlug}
      activeScreenTestId={activeScreenTestId}
    />
  );
}

function WorldTitleButton({ label, open, onPress }: Readonly<{ label: string; open: boolean; onPress: () => void }>) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <Pressable
      testID="world-screens-menu-toggle"
      onPress={onPress}
      style={styles.titleBtn}
      accessibilityRole="button"
      accessibilityLabel={t('donations.worldFeed.screensMenuA11y')}
      aria-expanded={open}
    >
      <Text style={styles.title} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.82}>
        {label}
      </Text>
      <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={iconSize.md} color={colors.textPrimary} />
    </Pressable>
  );
}

function WorldHeaderActions({
  worldSlug,
  activeFilterCount,
  onOpenFilters,
  mapFilter,
}: Readonly<{ worldSlug: string; activeFilterCount: number; onOpenFilters: () => void; mapFilter: PostFilterValue }>) {
  const router = useRouter();
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  return (
    <View style={styles.actions}>
      <TouchableOpacity
        testID="world-open-map"
        style={styles.iconBtn}
        onPress={() =>
          router.push({
            pathname: '/(tabs)/donations/marketplace/map',
            params: { world: worldSlug, filter: encodeMapFilter(mapFilter) },
          })
        }
        accessibilityRole="button"
        accessibilityLabel={t('feed.openMapA11y')}
      >
        <Ionicons name="map-outline" size={iconSize['2xl']} color={colors.textPrimary} />
      </TouchableOpacity>
      <FilterButton testID="world-feed-filter-button" activeCount={activeFilterCount} onPress={onOpenFilters} />
    </View>
  );
}

function WorldScreensMenu({
  visible,
  onClose,
  title,
  subScreens,
  feedPath,
  worldSlug,
  activeScreenTestId,
}: Readonly<{
  visible: boolean;
  onClose: () => void;
  title: string;
  subScreens: readonly WorldSubScreenLink[];
  feedPath: Href;
  worldSlug: string;
  activeScreenTestId: string;
}>) {
  const router = useRouter();
  const { t } = useTranslation();
  const go = (link: WorldSubScreenLink) => {
    onClose();
    if (link.testID === 'world-hub-my-listings') {
      router.push({ pathname: MY_LISTINGS_PATH, params: { world: worldSlug } });
      return;
    }
    router.push(link.path);
  };
  return (
    <ActionMenuSheet visible={visible} onDismiss={onClose} cancelLabel={t('general.close')} title={title}>
      <SheetActionRow
        testID="world-menu-feed"
        label={t('donations.worldFeed.feedTab')}
        icon={activeScreenTestId === 'world-menu-feed' ? 'checkmark' : undefined}
        onPress={() => {
          onClose();
          router.push(feedPath);
        }}
      />
      {subScreens.map((link) => (
        <SheetActionRow
          key={link.testID}
          testID={link.testID}
          label={t(link.labelKey)}
          icon={activeScreenTestId === link.testID ? 'checkmark' : undefined}
          onPress={() => go(link)}
        />
      ))}
    </ActionMenuSheet>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  titleBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: spacing.xs, maxWidth: '100%' },
  title: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, flexShrink: 1 },
  actions: { flexDirection: 'row' as const, alignItems: 'center' as const },
  iconBtn: { padding: spacing.xs },
}));
