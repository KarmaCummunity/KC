// app/apps/mobile/src/components/admin/admins/layers/LayerPersonChip.tsx
// FR-ADMIN-028 — one named role-holder inside a hierarchy level.
//
// A compact vertical tile: avatar wrapped in an org-coloured ring, the name,
// and the person's highest role (+N when the person holds more roles at the
// same level). Tapping opens the admin-detail card.
import { Pressable, View } from 'react-native';
import type { LayerPerson } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { AvatarInitials } from '../../../AvatarInitials';
import { rowDirectionStart } from '../../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../../i18n/useLocaleBundle';

const AVATAR_SIZE = 40;
const RING_WIDTH = 2;

export interface LayerPersonChipProps {
  readonly person: LayerPerson;
  readonly orgName: string;
  /** Ring colour identifying the person's organisation. */
  readonly orgAccent: string;
  readonly onSelect: (userId: string) => void;
}

export function LayerPersonChip({ person, orgName, orgAccent, onSelect }: LayerPersonChipProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const name = person.displayName ?? L.admin.admins.row.unnamed;
  const [topRole] = person.roles;
  const roleLabel = topRole ? L.admin.roles[topRole] : '';
  const extraRoles = person.roles.length - 1;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={L.admin.admins.layers.personA11y(name, roleLabel, orgName, extraRoles)}
      onPress={() => onSelect(person.userId)}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
    >
      <View style={[styles.ring, { borderColor: orgAccent }]}>
        <AvatarInitials name={name} avatarUrl={person.avatarUrl} size={AVATAR_SIZE} />
      </View>
      <Text style={styles.name} numberOfLines={1}>{name}</Text>
      <View style={styles.roleRow}>
        <Text style={styles.role} numberOfLines={1}>{roleLabel}</Text>
        {extraRoles > 0 && (
          <Text style={styles.more}>{L.admin.admins.layers.moreRoles(extraRoles)}</Text>
        )}
      </View>
    </Pressable>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  tile: {
    width: 84, alignItems: 'center', gap: spacing.xs,
    paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderRadius: radius.md,
  },
  pressed: { backgroundColor: colors.surfaceRaised, opacity: 0.85 },
  ring: {
    padding: RING_WIDTH, borderWidth: RING_WIDTH, borderRadius: radius.full,
  },
  name:    { ...typography.bodySmall, ...typography.bold, color: colors.textPrimary, textAlign: 'center', maxWidth: 80 },
  roleRow: { flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs, maxWidth: 80 },
  role:    { ...typography.caption, ...typography.semiBold, color: colors.textSecondary, flexShrink: 1 },
  more:    { ...typography.caption, ...typography.extraBold, color: colors.textSecondary },
}));
