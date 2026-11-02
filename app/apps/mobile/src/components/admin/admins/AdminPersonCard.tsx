// app/apps/mobile/src/components/admin/admins/AdminPersonCard.tsx
// FR-ADMIN-022 — one card per user carrying all their roles. Tapping it opens
// the admin-detail screen. Replaces the per-grant row in the list (the per-role
// rows + revoke action now live on the detail screen).
import { Pressable, View } from 'react-native';
import type { AdminPerson } from '@kc/domain';
import { MirroredIcon } from '../../ui/MirroredIcon';
import { iconSize, makeUseStyles, radius, shadow, spacing, Text, typography, useTheme } from '@kc/ui';
import { AvatarInitials } from '../../AvatarInitials';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle, type LocaleBundle } from '../../../i18n/useLocaleBundle';
import { RoleBadge } from './RoleBadge';

const MAX_BADGES = 3;

function lastSeenLabel(L: LocaleBundle, d: Date | null): string {
  if (d === null) return L.admin.admins.row.neverSeen;
  const ms = Date.now() - d.getTime();
  if (ms < 60 * 60 * 1000) return L.admin.admins.row.seenMinutesAgo(Math.max(1, Math.floor(ms / 60_000)));
  if (ms < 24 * 60 * 60 * 1000) return L.admin.admins.row.seenHoursAgo(Math.floor(ms / 3_600_000));
  return L.admin.admins.row.seenDaysAgo(Math.floor(ms / 86_400_000));
}

export interface AdminPersonCardProps {
  readonly person: AdminPerson;
  readonly onPress: (userId: string) => void;
}

export function AdminPersonCard({ person, onPress }: AdminPersonCardProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  const name = person.displayName ?? L.admin.admins.row.unnamed;
  const badgeRoles = person.activeRoles.slice(0, MAX_BADGES);
  const overflow = person.activeRoles.length - badgeRoles.length;

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPress(person.userId)}
      style={({ pressed }) => [styles.card, pressed && styles.pressed, !person.hasActiveGrant && styles.revoked]}
    >
      <AvatarInitials name={name} avatarUrl={person.avatarUrl} size={44} />
      <View style={styles.body}>
        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <View style={styles.badges}>
          {badgeRoles.map((r) => <RoleBadge key={r} role={r} muted={!person.hasActiveGrant} />)}
          {overflow > 0 && <Text style={styles.more}>{L.admin.admins.card.rolesMore(overflow)}</Text>}
          {person.activeRoles.length === 0 && (
            <Text style={styles.noRole}>{L.admin.admins.card.rolesNone}</Text>
          )}
        </View>
        <Text style={styles.meta} numberOfLines={1}>{lastSeenLabel(L, person.lastSeenAt)}</Text>
      </View>
      <MirroredIcon name="chevron-forward" size={iconSize.md} color={colors.textSecondary} />
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.md,
    backgroundColor: colors.surface, borderRadius: radius.lg,
    paddingVertical: spacing.md, paddingHorizontal: spacing.md, marginHorizontal: spacing.base, marginVertical: spacing.xs,
    ...shadow.card,
  },
  pressed: { opacity: 0.7 },
  revoked: { opacity: 0.6 },
  body:    { flex: 1, gap: spacing.xs },
  name:    { fontSize: typography.button.fontSize, ...typography.bold, color: colors.textPrimary, textAlign: textAlignStart() },
  badges:  { flexDirection: rowDirectionStart, alignItems: 'center', flexWrap: 'wrap', gap: spacing.xs },
  more:    { fontSize: typography.caption.fontSize, ...typography.bold, color: colors.textSecondary },
  noRole:  { fontSize: typography.caption.fontSize, color: colors.textSecondary },
  meta:    { fontSize: typography.caption.fontSize, color: colors.textSecondary, textAlign: textAlignStart() },
}));
