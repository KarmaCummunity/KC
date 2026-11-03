// FR-AUTH-011 AC1 — bottom-sheet action picker for profile photo source.
// Camera button auto-hidden on web (no native camera).
// The frame, dismissal and motion come from the kit `BottomSheet` (spec 17 §4.1).
import React from 'react';
import { TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, typography, spacing, radius, Text } from '@kc/ui';
import { BottomSheet } from './ui/BottomSheet';
import { GhostButton } from './ui/Buttons';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { isCameraAvailable, type AvatarSource } from '../services/avatarUpload';

interface Props {
  readonly visible: boolean;
  readonly canRemove: boolean;
  readonly onPick: (source: AvatarSource) => void;
  readonly onRemove: () => void;
  readonly onClose: () => void;
}

export function PhotoSourceSheet({ visible, canRemove, onPick, onRemove, onClose }: Props) {
  const { t } = useTranslation();
  const styles = usePhotoSourceSheetStyles();
  return (
    <BottomSheet
      visible={visible}
      onDismiss={onClose}
      title={t('profile.photoSourceTitle')}
      footer={<GhostButton label={t('general.cancel')} size="md" fullWidth onPress={onClose} />}
    >
      {isCameraAvailable && (
        <TouchableOpacity
          style={styles.option}
          onPress={() => onPick('camera')}
          accessibilityRole="button"
          accessibilityLabel={t('profile.photoSourceCameraA11y')}
        >
          <Text style={styles.optionText}>{t('profile.photoSourceCameraOption')}</Text>
        </TouchableOpacity>
      )}

      <TouchableOpacity
        style={styles.option}
        onPress={() => onPick('gallery')}
        accessibilityRole="button"
        accessibilityLabel={t('profile.photoSourceGalleryA11y')}
      >
        <Text style={styles.optionText}>{t('profile.photoSourceGalleryOption')}</Text>
      </TouchableOpacity>

      {canRemove && (
        <TouchableOpacity
          style={styles.option}
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel={t('profile.photoSourceRemoveA11y')}
        >
          <Text style={[styles.optionText, styles.removeText]}>{t('profile.photoSourceRemoveOption')}</Text>
        </TouchableOpacity>
      )}
    </BottomSheet>
  );
}

const usePhotoSourceSheetStyles = makeUseStyles(({ colors }) => ({
  option: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    borderRadius: radius.md,
    backgroundColor: colors.background,
  },
  optionText: { ...typography.body, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  removeText: { color: colors.error },
}));
