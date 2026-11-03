// FR-FEED-017 — user result card for universal search.
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useTheme, Text } from '@kc/ui';
import type { UserSearchResult } from '@kc/domain';
import { AvatarInitials } from '../AvatarInitials';
import { isOpaqueSystemShareHandle } from '../../lib/shareHandleDisplay';
import { useSearchResultCardStyles } from './searchResultCard.styles';

export function UserResultCard({ user }: { user: UserSearchResult }) {
  const styles = useSearchResultCardStyles();
  const { colors } = useTheme();
  const router = useRouter();
  const { t } = useTranslation();
  const showHandle = !isOpaqueSystemShareHandle(user.shareHandle);
  const displayName = user.displayName ?? t('profile.fallbackName');
  const a11yLabel = showHandle ? `${displayName} — @${user.shareHandle}` : displayName;

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={() => router.push(`/user/${user.shareHandle}`)}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
    >
      <View style={styles.avatarWrap}>
        <AvatarInitials name={displayName} avatarUrl={user.avatarUrl} size={48} />
      </View>
      <View style={styles.cardContent}>
        <Text style={styles.cardTitle} numberOfLines={1}>{displayName}</Text>
        {showHandle ? <Text style={styles.cardHandle} numberOfLines={1}>@{user.shareHandle}</Text> : null}
        {user.biography ? <Text style={styles.cardSubtitle} numberOfLines={2}>{user.biography}</Text> : null}
        <View style={styles.metaRow}>
          <View style={styles.metaChip}>
            <Ionicons name="people-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.metaText}>{t('search.followers', { count: user.followersCount })}</Text>
          </View>
          <View style={styles.metaChip}>
            <Ionicons name="location-outline" size={12} color={colors.textSecondary} />
            <Text style={styles.metaText}>{user.cityName ?? t('profile.cityNotSet')}</Text>
          </View>
        </View>
      </View>
      <Ionicons name="chevron-back" size={20} color={colors.textDisabled} />
    </Pressable>
  );
}
