import React, { useCallback, useRef, useState } from 'react';
import { View, Platform, ScrollView, TouchableOpacity, type ViewStyle } from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useLocalSearchParams, usePathname } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, shadow, typography, spacing, useTheme, Text } from '@kc/ui';
import { isLayoutRtl } from '../../lib/rtlLayout';

/**
 * Anchor the menu FAB to the reading-end edge (same edge the drawer slides
 * from). Native auto-mirrors `end`; RN-Web ignores `start`/`end` for absolute
 * positioning, so on web we resolve RTL live and emit a physical key.
 */
function fabEndInset(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: spacing.base };
  return isLayoutRtl() ? { left: spacing.base } : { right: spacing.base };
}
import { BackButton } from '../../components/BackButton';
import { AnimatedEntry } from '../../components/animations/AnimatedEntry';
import { AboutNavDrawer } from './AboutNavDrawer';
import { AboutSectionBlocksTop } from './AboutSectionBlocksTop';
import { AboutSectionBlocksBottom } from './AboutSectionBlocksBottom';
import { AboutContentScopeProvider } from './AboutContentScopeContext';
import { AboutHero } from './AboutHero';
import { DonationSupportCard } from '../../components/DonationSupportCard';
import { ABOUT_NAV_LABEL_KEYS, type AboutSectionId } from './aboutSectionModel';
import { parseTruthyQueryParam } from '../../lib/query/parseTruthyQueryParam';
import { isAboutMarketingPath } from '../../navigation/aboutMarketingPaths';
import { useShellTabBarVisibility, shellTabBarHeightPx } from '../../navigation/useShellTabBarVisibility';
import { aboutRtlText, aboutWebViewRtl } from './aboutWebRtlStyle';

export function AboutLandingScreen() {
  const { t } = useTranslation();
  const styles = useAboutLandingScreenStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ hideTopBar?: string | string[]; hideBottomBar?: string | string[] }>();
  const pathname = usePathname() ?? '';
  const onAboutSurface = isAboutMarketingPath(pathname);
  const hideTop = onAboutSurface && parseTruthyQueryParam(params.hideTopBar);
  const hideBottom = onAboutSurface && parseTruthyQueryParam(params.hideBottomBar);
  const showShellTabBar = useShellTabBarVisibility();
  const tabPad = hideBottom ? 0 : shellTabBarHeightPx(showShellTabBar);

  const scrollRef = useRef<ScrollView>(null);
  const yMap = useRef<Partial<Record<AboutSectionId, number>>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  const onSectionY = useCallback((id: AboutSectionId, y: number) => {
    yMap.current[id] = y;
  }, []);

  const scrollTo = useCallback((id: AboutSectionId) => {
    const y = yMap.current[id];
    if (y == null) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 10), animated: true });
  }, []);

  const labelFor = useCallback(
    (id: AboutSectionId) => t(`aboutContent.${ABOUT_NAV_LABEL_KEYS[id]}` as 'aboutContent.navNumbers'),
    [t],
  );

  const bottomFab = 20 + tabPad + insets.bottom;

  return (
    <SafeAreaView style={styles.safe} edges={hideTop ? [] : ['top']}>
      {!hideTop ? (
        <View style={styles.header}>
          <BackButton tintColor={colors.primary} />
          <Text style={styles.title}>{t('aboutContent.title')}</Text>
          <View style={{ width: 40 }} />
        </View>
      ) : null}

      <ScrollView
        ref={scrollRef}
        contentContainerStyle={[
          styles.scroll,
          {
            paddingBottom: spacing['4xl'] + tabPad,
            paddingHorizontal: spacing.base,
            gap: spacing.lg,
            ...aboutWebViewRtl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <AboutContentScopeProvider>
          <AnimatedEntry delay={0}>
            <AboutHero />
          </AnimatedEntry>
          <AnimatedEntry delay={240}>
            <DonationSupportCard />
          </AnimatedEntry>
          <AboutSectionBlocksTop onSectionY={onSectionY} />
          <AboutSectionBlocksBottom onSectionY={onSectionY} delayStart={360} />
        </AboutContentScopeProvider>
        <View style={styles.footer}>
          <Text style={styles.footerV}>{t('aboutContent.footerVersion')}</Text>
          <Text style={styles.footerR}>{t('aboutContent.footerRights')}</Text>
          <Text style={styles.footerR}>{t('aboutContent.footerDataCredit')}</Text>
        </View>
      </ScrollView>

      <TouchableOpacity
        style={[styles.fab, { bottom: bottomFab }]}
        onPress={() => setMenuOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={t('aboutContent.menuFab')}
      >
        <Ionicons name="menu" size={iconSize['2xl']} color={colors.textInverse} />
      </TouchableOpacity>

      <AboutNavDrawer
        visible={menuOpen}
        menuTitle={t('aboutContent.menuTitle')}
        hint={t('aboutContent.sectionNavHint')}
        onClose={() => setMenuOpen(false)}
        onSelect={scrollTo}
        labelFor={labelFor}
      />
    </SafeAreaView>
  );
}

const useAboutLandingScreenStyles = makeUseStyles(({ colors }) => ({
  safe: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    ...aboutWebViewRtl,
  },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    ...aboutRtlText,
  },
  scroll: { flexGrow: 1 },
  footer: { alignItems: 'stretch', marginTop: spacing.xl, ...aboutWebViewRtl },
  footerV: {
    ...typography.label,
    color: colors.textSecondary,
    marginBottom: spacing.xs,
    ...aboutRtlText,
  },
  footerR: {
    ...typography.caption,
    color: colors.textDisabled,
    ...aboutRtlText,
  },
  fab: {
    position: 'absolute',
    ...fabEndInset(),
    width: 56,
    height: 56,
    borderRadius: radius.full,
    backgroundColor: colors.secondary,
    alignItems: 'center',
    justifyContent: 'center',
    // The brand lift for floating actions (D87), in the theme's neutral shadow colour.
    ...shadow.glow,
    shadowColor: colors.shadow,
  },
}));
