import { useState } from 'react';
import { Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import type { PostWithOwner } from '@kc/application';
import { makeUseStyles, spacing, iconSize, useTheme } from '@kc/ui';
import { hasPermission, type AdminRole } from '@kc/domain';
import { useAuthStore } from '../../store/authStore';
import { useAdminRoles } from '../../hooks/useAdminRoles';
import { invalidatePersonalStatsCaches } from '../../lib/invalidatePersonalStatsCaches';
import { PostMenuSheet } from './PostMenuSheet';
import { usePostSavedActions } from '../../hooks/usePostSavedActions';
import { hrefForPostEdit } from '../../lib/postEditNavigation';

interface Props {
  post: PostWithOwner;
  /** Override icon color (e.g. white on image overlays). */
  iconColor?: string;
  /**
   * `overlay` fills the parent touch target (grid card menu chip).
   * `header` uses a compact bar-button footprint (post detail nav).
   */
  placement?: 'overlay' | 'header';
  /** When false, omits the share row (post detail already has a header share button). */
  showShareInMenu?: boolean;
  /** Smaller ⋮ icon for dense profile 3-column grids. */
  overlaySize?: 'default' | 'compact';
}

export function PostMenuButton({
  post,
  iconColor,
  placement = 'overlay',
  overlaySize = 'default',
  showShareInMenu = true,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const queryClient = useQueryClient();
  const styles = usePostMenuButtonStyles();
  const { colors } = useTheme();
  const viewerId = useAuthStore((s) => s.session?.userId ?? null);
  const { roles } = useAdminRoles();
  const canManuallyRemovePost = hasPermission(roles as readonly AdminRole[], 'reports.manual_remove_post');
  const [open, setOpen] = useState(false);
  // The saved state is only shown inside the sheet, so it is looked up when the sheet opens
  // (not once per rendered card). The toggle stays disabled until that first lookup resolves,
  // so a tap can never act on an unknown state.
  const { isSaved, isLoading: savedLoading, busy: saveBusy, toggleSave } = usePostSavedActions(
    post.postId,
    { enabled: open },
  );

  if (viewerId === null) {
    // Guests don't get a menu (no actions available to them).
    return null;
  }

  return (
    <>
      <Pressable
        style={placement === 'header' ? styles.btnHeader : styles.btnOverlay}
        onPress={() => setOpen(true)}
        accessibilityLabel={t('post.menuA11y')}
        accessibilityRole="button"
        hitSlop={8}
      >
        <Ionicons
          name="ellipsis-vertical"
          size={
            placement === 'header'
              ? iconSize.xl
              : overlaySize === 'compact'
                ? iconSize.xs
                : iconSize.lg
          }
          color={iconColor ?? colors.textPrimary}
        />
      </Pressable>

      <PostMenuSheet
        visible={open}
        onClose={() => setOpen(false)}
        post={post}
        showShareInMenu={showShareInMenu}
        listingId={post.listingId ?? null}
        viewerId={viewerId}
        isSuperAdmin={canManuallyRemovePost}
        isSaved={isSaved}
        saveBusy={saveBusy || savedLoading}
        onToggleSave={toggleSave}
        onAfterRemoval={() => {
          void queryClient.invalidateQueries({ queryKey: ['my-posts'] });
          void queryClient.invalidateQueries({ queryKey: ['profile-other-posts'] });
          void queryClient.invalidateQueries({ queryKey: ['post', post.postId] });
          void queryClient.invalidateQueries({ queryKey: ['feed'] });
          invalidatePersonalStatsCaches(queryClient, viewerId);
          invalidatePersonalStatsCaches(queryClient, post.ownerId);
          router.back();
        }}
        onEdit={() => router.push(hrefForPostEdit(post))}
      />
    </>
  );
}

const usePostMenuButtonStyles = makeUseStyles(() => ({
  btnOverlay: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  btnHeader: {
    paddingStart: 0,
    paddingEnd: spacing.xs,
    paddingVertical: spacing.xs,
    justifyContent: 'center',
    alignItems: 'center',
  },
}));
