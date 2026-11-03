import React from 'react';
import {
  ActivityIndicator,
  Image,
  Platform,
  TouchableOpacity,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { MAX_MEDIA_ASSETS } from '@kc/domain';
import type { UploadedAsset } from '../../services/imageUpload';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { isLayoutRtl } from '../../lib/rtlLayout';

/**
 * Pin the remove (X) button to the thumbnail's reading-end corner.
 * Native auto-mirrors `end`; RN-Web ignores `start`/`end` for absolute
 * positioning, so on web we resolve RTL live and emit a physical key.
 */
function removeBtnCornerEnd(): Pick<ViewStyle, 'left' | 'right' | 'end'> {
  if (Platform.OS !== 'web') return { end: 4 };
  return isLayoutRtl() ? { left: 4 } : { right: 4 };
}

/** What a thumbnail needs: a stable id (`path`, also the remove key) and a preview URI. */
export type PhotoPickerItem = Pick<UploadedAsset, 'path' | 'previewUri'>;

interface Props {
  uploads: readonly PhotoPickerItem[];
  isUploading: boolean;
  uploadingCount: number;
  required: boolean;
  onAdd: () => void;
  onRemove: (path: string) => void;
}

const THUMB = 96;

const usePhotoPickerStyles = makeUseStyles(({ colors, isDark }) => ({
  section: { gap: spacing.xs },
  sectionLabel: { ...typography.label, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  required: { color: colors.error },
  grid: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: spacing.sm },
  thumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    overflow: 'hidden' as const,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    borderWidth: isDark ? 1 : 0,
    borderColor: isDark ? colors.border : 'transparent',
  },
  thumbImage: { width: '100%', height: '100%' },
  pending: { backgroundColor: colors.skeleton },
  addBtn: {
    borderWidth: 2,
    borderStyle: 'dashed' as const,
    borderColor: colors.border,
    backgroundColor: colors.background,
    gap: spacing.xs,
  },
  addText: { ...typography.caption, color: colors.textSecondary },
  removeBtn: {
    position: 'absolute' as const,
    top: 4,
    ...removeBtnCornerEnd(),
    width: 22,
    height: 22,
    borderRadius: radius.full,
    backgroundColor: colors.overlay,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
  },
  hint: { ...typography.caption, color: colors.textDisabled, textAlign: rtlTextAlignStart },
}));

export function PhotoPicker({ uploads, isUploading, uploadingCount, required, onAdd, onRemove }: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = usePhotoPickerStyles();
  const remaining = MAX_MEDIA_ASSETS - uploads.length - uploadingCount;
  const canAdd = remaining > 0 && !isUploading;

  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>
        {t('post.photos')}{' '}
        {required && <Text style={styles.required}>{t('post.photosRequiredSuffix')}</Text>}
      </Text>
      <View style={styles.grid}>
        {uploads.map((u) => (
          <View key={u.path} style={styles.thumb}>
            <Image source={{ uri: u.previewUri }} style={styles.thumbImage} />
            <TouchableOpacity
              style={styles.removeBtn}
              onPress={() => onRemove(u.path)}
              accessibilityRole="button"
              accessibilityLabel={t('post.removePhoto')}
            >
              <Ionicons name="close" size={iconSize.xs} color={colors.textInverse} />
            </TouchableOpacity>
          </View>
        ))}
        {Array.from({ length: uploadingCount }).map((_, i) => (
          <View key={`pending-${i}`} style={[styles.thumb, styles.pending]}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ))}
        {canAdd && (
          <TouchableOpacity
            style={[styles.thumb, styles.addBtn]}
            onPress={onAdd}
            disabled={!canAdd}
            accessibilityRole="button"
            accessibilityLabel={t('post.addPhoto')}
          >
            <Ionicons name="add" size={iconSize['2xl']} color={colors.textSecondary} />
            <Text style={styles.addText}>{remaining}/{MAX_MEDIA_ASSETS}</Text>
          </TouchableOpacity>
        )}
      </View>
      {uploads.length === 0 && !isUploading && (
        <Text style={styles.hint}>{t('post.photosHint', { max: MAX_MEDIA_ASSETS })}</Text>
      )}
    </View>
  );
}
