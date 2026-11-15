// FR-POST-023 (P2.33) — header share button on the post-detail screen.
import { Platform, Pressable, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import type { PostWithOwner } from '@kc/application';
import { makeUseStyles, spacing, iconSize, useTheme } from '@kc/ui';
import { usePostShare } from '../../hooks/usePostShare';

interface Props {
  post: PostWithOwner;
  /** Compact nav-bar footprint (post detail header). */
  placement?: 'default' | 'header';
}

export function PostShareButton({ post, placement = 'default' }: Props) {
  const { t } = useTranslation();
  const styles = usePostShareButtonStyles();
  const { colors } = useTheme();
  const { canShare, share, busy } = usePostShare(post);

  if (!canShare) return null;

  return (
    <Pressable
      style={placement === 'header' ? styles.btnHeader : styles.btn}
      onPress={() => void share()}
      disabled={busy}
      accessibilityLabel={t('share.post.a11y')}
      accessibilityRole="button"
      accessibilityState={{ busy }}
      hitSlop={8}
    >
      {busy ? (
        <ActivityIndicator size="small" color={colors.textPrimary} />
      ) : (
        <Ionicons
          name={Platform.OS === 'ios' ? 'share-outline' : 'share-social-outline'}
          size={iconSize.xl}
          color={colors.textPrimary}
        />
      )}
    </Pressable>
  );
}

const usePostShareButtonStyles = makeUseStyles(() => ({
  btn: { padding: spacing.xs, marginEnd: spacing.xs },
  btnHeader: { paddingVertical: spacing.xs, paddingHorizontal: spacing.xs },
}));
