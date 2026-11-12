// Home-feed aside — quick links into the giving worlds (FR-RESP-003).
// The first giving-world tiles of the Donations hub; reuses the hub's config.
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { AsideCard } from './AsideCard';
import { DONATIONS_HUB_TILES } from '../../navigation/donationsHubTiles';

// D62 — the first world tiles of the Donations hub (one list, G2); domains are not worlds.
const WORLDS = DONATIONS_HUB_TILES.slice(0, 4);

export function GivingWorldsAside() {
  const styles = useStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();

  return (
    <AsideCard title={t('aside.givingWorldsTitle')}>
      {WORLDS.map((world) => (
        <TouchableOpacity
          key={world.key}
          style={styles.row}
          accessibilityRole="button"
          testID={`aside-world-${world.key}`}
          onPress={() => router.push(world.href)}
        >
          <View style={styles.iconWrap}>
            <Ionicons name={world.icon} size={iconSize.sm} color={colors.primary} />
          </View>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {t(world.titleKey)}
          </Text>
        </TouchableOpacity>
      ))}
      <TouchableOpacity
        style={styles.row}
        accessibilityRole="button"
        testID="aside-follow-suggestions"
        onPress={() => router.push('/follow/suggestions')}
      >
        <View style={styles.iconWrap}>
          <Ionicons name="person-add-outline" size={iconSize.sm} color={colors.primary} />
        </View>
        <Text style={styles.rowLabel} numberOfLines={1}>
          {t('follow.suggestionsTitle')}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        accessibilityRole="button"
        testID="aside-world-all"
        onPress={() => router.push('/(tabs)/donations')}
      >
        <Text style={styles.allLink}>{t('aside.givingWorldsAll')}</Text>
      </TouchableOpacity>
    </AsideCard>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
  rowLabel: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    textAlign: rtlTextAlignStart,
  },
  allLink: {
    ...typography.bodySmall,
    color: colors.primary,
    marginTop: spacing.xs,
    textAlign: rtlTextAlignStart,
  },
}));
