// Full-screen image viewer for post detail — tap carousel to inspect images (contain, no crop).
// Mapped to: FR-POST-014 AC1.
import React, { useEffect, useRef, useState } from 'react';
import { Modal, NativeScrollEvent, NativeSyntheticEvent, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, radius, spacing, typography, useTheme, zIndex, Text } from '@kc/ui';
import { KcFlashList, type KcFlashListRef } from './lists/KcFlashList';
import { KCImage } from './ui/KCImage';

export interface PostImageViewerModalProps {
  readonly visible: boolean;
  readonly urls: readonly string[];
  readonly initialIndex: number;
  readonly onClose: () => void;
}

export function PostImageViewerModal({
  visible,
  urls,
  initialIndex,
  onClose,
}: PostImageViewerModalProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const { t } = useTranslation();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<KcFlashListRef<string>>(null);
  const [activeIndex, setActiveIndex] = useState(initialIndex);

  const safeInitial = Math.min(Math.max(0, initialIndex), Math.max(0, urls.length - 1));

  useEffect(() => {
    if (!visible || urls.length === 0) return;
    setActiveIndex(safeInitial);
    const t = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index: safeInitial, animated: false });
    });
    return () => cancelAnimationFrame(t);
  }, [visible, safeInitial, urls.length]);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / width);
    setActiveIndex((prev) => {
      if (i >= 0 && i < urls.length && i !== prev) return i;
      return prev;
    });
  };

  if (urls.length === 0) return null;

  return (
    <Modal // brand-guard-allow: full-screen image viewer, not a centred dialog
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.root}>
        <TouchableOpacity
          style={[styles.closeBtn, { top: insets.top + spacing.sm }]}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('post.imageViewerClose')}
        >
          <Ionicons
            name="close"
            size={32} // brand-guard-allow: viewer chrome glyph above the icon scale (spec 17 §4.2)
            color={colors.textInverse}
          />
        </TouchableOpacity>

        {urls.length > 1 ? (
          <View style={[styles.counter, { top: insets.top + spacing.sm }]} pointerEvents="none">
            <Text style={styles.counterText}>
              {activeIndex + 1}
              {' / '}
              {urls.length}
            </Text>
          </View>
        ) : null}

        <KcFlashList
          ref={listRef}
          style={styles.list}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          data={[...urls]}
          keyExtractor={(u, i) => `viewer-${i}-${u}`}
          initialScrollIndex={safeInitial}
          estimatedItemSize={width}
          renderItem={({ item }) => (
            <KCImage
              uri={item}
              style={{ width, height, backgroundColor: colors.shadow }}
              contentFit="contain"
              recyclingKey={item}
              noPlaceholder
            />
          )}
          onScroll={onScroll}
          scrollEventThrottle={16}
        />
      </View>
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  root: {
    flex: 1,
    backgroundColor: colors.shadow,
    justifyContent: 'center',
  },
  closeBtn: {
    position: 'absolute',
    start: spacing.md,
    zIndex: zIndex.overlay,
    padding: spacing.xs,
  },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: zIndex.raised,
    paddingHorizontal: spacing.sm,
    // Nearest spacing step above the former 2pt (no 2 on the scale).
    paddingVertical: spacing.xs,
    backgroundColor: colors.overlay,
    borderRadius: radius.full,
  },
  counterText: {
    ...typography.caption,
    ...typography.semiBold,
    color: colors.textInverse,
  },
  list: { flex: 1 },
}));
