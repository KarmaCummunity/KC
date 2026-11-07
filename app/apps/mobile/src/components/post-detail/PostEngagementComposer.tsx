import React, { useEffect, useState } from 'react';
import { Keyboard, Platform, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, radius, iconSize, useTheme, Text, TextInput } from '@kc/ui';
import { emptyInputDirectionStyle } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { MirroredIcon } from '../ui/MirroredIcon';
import { usePostEngagement } from './PostEngagementContext';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';

type Props = Readonly<{
  /** When true, sits inside `PostDetailBottomChrome` (no outer dock border/background). */
  embedded?: boolean;
  /** Tab bar / floating CTA inset above the composer dock (standalone mode only). */
  bottomOverlayInset?: number;
}>;

export function PostEngagementComposer({ embedded = false, bottomOverlayInset = 0 }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const engagement = usePostEngagement();
  const tabBarPad = useShellTabBarScrollInset(0);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', () => setKeyboardOpen(true));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  if (!engagement) return null;

  const { draft, replyTo, setDraft, clearReply, onSubmitComment, busy } = engagement;
  const canSend = draft.trim().length > 0 && !busy;
  const padBottom = embedded
    ? 0
    : (keyboardOpen ? spacing.sm : tabBarPad) + bottomOverlayInset;

  return (
    <View
      style={[
        embedded ? styles.embedded : styles.dock,
        !embedded && padBottom > 0 ? { paddingBottom: padBottom } : null,
      ]}
      testID="post-engagement-composer"
    >
      {replyTo ? (
        <View style={styles.replyBanner}>
          <Text style={styles.replyBannerText} numberOfLines={1}>
            {t('post.engagement.replyingTo', { name: replyTo.authorLabel })}
          </Text>
          <Pressable accessibilityRole="button" accessibilityLabel={t('post.engagement.cancelReply')} onPress={clearReply}>
            <MirroredIcon name="close" size={iconSize.md} color={colors.textSecondary} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.row}>
        <View style={styles.fieldWrap}>
          <TextInput // brand-guard-allow: docked social composer (like chat), not a form field
            style={[styles.input, draft.length === 0 ? emptyInputDirectionStyle() : null]}
            value={draft}
            onChangeText={setDraft}
            placeholder={
              replyTo ? t('post.engagement.replyPlaceholder') : t('post.engagement.commentPlaceholder')
            }
            placeholderTextColor={colors.textDisabled}
            multiline
            maxLength={2000}
          />
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('post.engagement.commentSend')}
          style={({ pressed }) => [
            styles.sendBtn,
            !canSend ? styles.sendBtnDisabled : null,
            pressed && canSend ? styles.sendBtnPressed : null,
          ]}
          onPress={onSubmitComment}
          disabled={!canSend}
        >
          <MirroredIcon
            name="send"
            size={iconSize.sm}
            color={canSend ? colors.textInverse : colors.textSecondary}
          />
        </Pressable>
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  dock: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
    paddingTop: spacing.sm,
    paddingHorizontal: spacing.base,
    ...(Platform.OS === 'web' ? {} : { width: '100%' }),
  },
  embedded: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xs,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
  },
  replyBannerText: { ...typography.caption, color: colors.textSecondary, flex: 1, textAlign: rtlTextAlignStart },
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.xs },
  fieldWrap: {
    flex: 1,
    minHeight: 40,
    maxHeight: 96,
    borderRadius: radius.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: isDark ? colors.surfaceRaised : colors.background,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
  },
  input: {
    ...typography.body,
    fontSize: 15,
    color: colors.textPrimary,
    minHeight: 22,
    textAlignVertical: 'center',
    textAlign: 'auto',
    writingDirection: 'auto',
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: radius.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendBtnDisabled: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  sendBtnPressed: { opacity: 0.9 },
}));
