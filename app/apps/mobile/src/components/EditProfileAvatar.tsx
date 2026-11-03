// FR-PROFILE-007 — avatar editor block for the Edit Profile screen.
// Owns the local upload state + PhotoSourceSheet so the parent screen stays
// focused on form orchestration. The parent receives the new URL (or null)
// via `onChange` and is responsible for persisting on Save.
import React, { useState } from 'react';
import { ActivityIndicator, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { AvatarInitials } from './AvatarInitials';
import { NotifyModal } from './NotifyModal';
import { PhotoSourceSheet } from './PhotoSourceSheet';
import { pickAvatarImage, resizeAndUploadAvatar, type AvatarSource } from '../services/avatarUpload';

interface Props {
  readonly userId: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly disabled?: boolean;
  readonly onChange: (next: string | null) => void;
}

export function EditProfileAvatar({ userId, displayName, avatarUrl, disabled, onChange }: Props) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const [sheetVisible, setSheetVisible] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const busy = !!disabled || uploading;

  const handlePick = async (source: AvatarSource) => {
    setSheetVisible(false);
    setUploading(true);
    try {
      const picked = await pickAvatarImage(source);
      if (!picked) return;
      const url = await resizeAndUploadAvatar(picked, userId);
      onChange(url);
    } catch (err) {
      // TD-138: `Alert.alert` is a no-op on react-native-web@0.21.2 — use NotifyModal.
      setErrorMsg(err instanceof Error ? err.message : t('profile.avatarUploadRetry'));
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    setSheetVisible(false);
    onChange(null); // staged — persisted on Save
  };

  return (
    <View style={styles.wrap}>
      <TouchableOpacity
        onPress={() => !busy && setSheetVisible(true)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={avatarUrl ? t('profile.avatarChangeA11y') : t('profile.avatarAddA11y')}
      >
        <AvatarInitials name={displayName || t('profile.fallbackName')} avatarUrl={avatarUrl} size={104} />
        {uploading && (
          <View style={styles.spinner}><ActivityIndicator color={colors.textInverse} /></View>
        )}
      </TouchableOpacity>
      <Text style={styles.hint}>{avatarUrl ? t('profile.avatarChangeHint') : t('profile.avatarAddHint')}</Text>
      <PhotoSourceSheet
        visible={sheetVisible}
        canRemove={!!avatarUrl}
        onPick={handlePick}
        onRemove={handleRemove}
        onClose={() => setSheetVisible(false)}
      />
      <NotifyModal
        visible={!!errorMsg}
        title={t('profile.avatarUploadFailedTitle')}
        message={errorMsg ?? ''}
        onDismiss={() => setErrorMsg(null)}
      />
    </View>
  );
}

const useStyles = makeUseStyles(({ colors, isDark }) => ({
  wrap: { alignItems: 'center', marginVertical: spacing.base, gap: spacing.sm },
  spinner: {
    position: 'absolute', width: 104, height: 104, borderRadius: 52,
    backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center',
  },
  hint: { ...typography.caption, color: colors.primary },
}));
