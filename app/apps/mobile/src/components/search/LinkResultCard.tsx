// FR-FEED-017 — donation link result card for universal search.
import { Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useTheme, Text } from '@kc/ui';
import type { DonationLinkSearchResult } from '@kc/domain';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { useSearchResultCardStyles } from './searchResultCard.styles';

export function LinkResultCard({ link }: { link: DonationLinkSearchResult }) {
  const styles = useSearchResultCardStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const categoryLabel = t(`search.donationCategories.${link.categorySlug}`);
  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => openExternalUrl(link.url)}
      accessibilityRole="link"
      accessibilityLabel={`${link.displayName} — ${categoryLabel}`}
    >
      <View style={styles.linkIconWrap}>
        <Ionicons name="link-outline" size={24} color={colors.secondary} />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>{link.displayName}</Text>
        <View style={styles.categoryTag}>
          <Text style={styles.categoryTagText}>{categoryLabel}</Text>
        </View>
        {link.description ? <Text style={styles.cardSubtitle} numberOfLines={2}>{link.description}</Text> : null}
        <Text style={styles.linkUrl} numberOfLines={1}>{link.url}</Text>
      </View>
      <Ionicons name="open-outline" size={18} color={colors.textDisabled} />
    </Pressable>
  );
}
