// A member name followed by their verification badge on the reading-start side (FR-VERIFY-001 AC2).
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, spacing } from '@kc/ui';
import type { VerificationLevel } from '@kc/domain';
import { rowDirectionStart } from '../lib/rtlLayout';
import { VerificationBadge } from './VerificationBadge';

export interface NameWithBadgeProps {
  readonly level: VerificationLevel | undefined;
  readonly children: React.ReactNode;
}

export function NameWithBadge({ level, children }: NameWithBadgeProps) {
  const styles = useStyles();
  return (
    <View style={styles.row}>
      <View style={styles.nameSlot}>{children}</View>
      <View style={styles.badgeSlot}>
        <VerificationBadge level={level} />
      </View>
    </View>
  );
}

const useStyles = makeUseStyles(() => ({
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center' as const,
    gap: spacing.xs,
    alignSelf: 'stretch' as const,
    minWidth: 0,
  },
  nameSlot: { flex: 1, minWidth: 0 },
  badgeSlot: { flexShrink: 0 },
}));
