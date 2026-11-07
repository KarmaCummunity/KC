// Avatar with a verification mark at the reading-end corner (FR-VERIFY-001 AC2).
import React from 'react';
import { View } from 'react-native';
import { makeUseStyles, iconSize, radius } from '@kc/ui';
import type { VerificationLevel } from '@kc/domain';
import { AvatarInitials } from './AvatarInitials';
import { VerificationBadge } from './VerificationBadge';

export interface AvatarWithVerificationBadgeProps {
  readonly name: string;
  readonly avatarUrl: string | null;
  readonly size: number;
  readonly verificationLevel?: VerificationLevel;
  /** `detail` — slightly larger mark for publisher rows on post / listing detail. */
  readonly emphasis?: 'compact' | 'detail';
}

function badgeIconSize(size: number, emphasis: 'compact' | 'detail'): number {
  const ratio = emphasis === 'detail' ? 0.34 : 0.3;
  const floor = emphasis === 'detail' ? 12 : 10;
  const cap = emphasis === 'detail' ? iconSize.md : iconSize.sm;
  return Math.min(cap, Math.max(floor, Math.round(size * ratio)));
}

export function AvatarWithVerificationBadge({
  name,
  avatarUrl,
  size,
  verificationLevel,
  emphasis = 'compact',
}: AvatarWithVerificationBadgeProps) {
  const styles = useStyles();
  const badgeSize = badgeIconSize(size, emphasis);
  return (
    <View style={[styles.wrap, { width: size, height: size }]}>
      <AvatarInitials name={name} avatarUrl={avatarUrl} size={size} />
      {verificationLevel ? (
        <View style={styles.badge} pointerEvents="none">
          <VerificationBadge level={verificationLevel} size={badgeSize} />
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: {
    position: 'relative' as const,
    flexShrink: 0,
  },
  badge: {
    position: 'absolute' as const,
    end: -1,
    bottom: -1,
    backgroundColor: colors.surface,
    borderRadius: radius.full,
  },
}));
