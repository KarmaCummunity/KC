import React from 'react';
import {
  Modal,
  View,
  Pressable,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { MirroredIcon } from '../../components/ui/MirroredIcon';
import { iconSize, makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';
import { absoluteCornerEnd } from '../../lib/rtlLayout';
import type { AboutSectionId } from './aboutSectionModel';
import { ABOUT_NAV_ITEMS } from './aboutSectionModel';

export interface AboutNavDrawerProps {
  readonly visible: boolean;
  readonly menuTitle: string;
  readonly hint: string;
  readonly onClose: () => void;
  readonly onSelect: (id: AboutSectionId) => void;
  readonly labelFor: (id: AboutSectionId) => string;
}

export function AboutNavDrawer({
  visible,
  menuTitle,
  hint,
  onClose,
  onSelect,
  labelFor,
}: AboutNavDrawerProps) {
  const styles = useAboutNavDrawerStyles();
  const { colors } = useTheme();
  return (
    <Modal transparent animationType="fade" visible={visible} onRequestClose={onClose} /* brand-guard-allow: side drawer is not the centred kit Modal or a BottomSheet */>
      <View style={styles.root}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={hint} />
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>{menuTitle}</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Ionicons name="close" size={28} color={colors.textPrimary} /* brand-guard-allow: close control is larger than iconSize.2xl */ />
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>{hint}</Text>
          <ScrollView contentContainerStyle={styles.list}>
            {ABOUT_NAV_ITEMS.map((row) => (
              <TouchableOpacity
                key={row.id}
                style={styles.row}
                onPress={() => {
                  onSelect(row.id);
                  onClose();
                }}
              >
                <Ionicons name={row.icon as 'home'} size={iconSize.xl} color={colors.secondary} />
                <Text style={styles.rowLabel}>{labelFor(row.id)}</Text>
                <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textDisabled} />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const useAboutNavDrawerStyles = makeUseStyles(({ colors }) => ({
  root: { flex: 1 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: colors.overlay },
  sheet: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    ...absoluteCornerEnd(0),
    width: '82%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    paddingTop: spacing.xl,
    borderTopStartRadius: radius.xl,
    borderBottomStartRadius: radius.xl,
  },
  sheetHeader: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  sheetTitle: { ...typography.h3, color: colors.textPrimary, ...aboutRtlText },
  hint: {
    ...typography.caption,
    color: colors.textSecondary,
    ...aboutRtlText,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  list: { paddingBottom: spacing['2xl'] },
  row: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowLabel: { flex: 1, ...typography.body, color: colors.textPrimary, ...aboutRtlText },
}));
