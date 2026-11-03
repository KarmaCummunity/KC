// app/apps/mobile/src/components/admin/admins/OrgSwitcher.tsx
// FR-ADMIN-025 — org filter for the hierarchy tree. super_admin can switch
// between orgs (or view all); scoped admins are pinned to their org upstream.
import { ScrollView, Pressable, View } from 'react-native';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { rowDirectionStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface OrgOption {
  readonly id: string;
  readonly name: string;
}

export interface OrgSwitcherProps {
  readonly orgs: readonly OrgOption[];
  readonly selected: string | null;
  readonly onSelect: (orgId: string | null) => void;
  /** Optional colour key per org (FR-ADMIN-028 layered view); renders a dot. */
  readonly accents?: ReadonlyMap<string, string>;
}

export function OrgSwitcher({ orgs, selected, onSelect, accents }: OrgSwitcherProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const chip = (id: string | null, label: string) => {
    const accent = id === null ? undefined : accents?.get(id);
    return (
      <Pressable
        key={id ?? 'all'}
        accessibilityRole="button"
        accessibilityState={{ selected: selected === id }}
        onPress={() => onSelect(id)}
        style={[styles.pill, selected === id && styles.pillActive]}
      >
        {/* A ring keeps the dot visible on the selected chip, whose fill can match the accent. */}
        {accent !== undefined && (
          <View style={[styles.dot, { backgroundColor: accent }, selected === id && styles.dotActive]} />
        )}
        <Text style={[styles.pillText, selected === id && styles.pillTextActive]}>{label}</Text>
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.bar}
    >
      {chip(null, L.admin.admins.tree.orgAll)}
      {orgs.map((o) => chip(o.id, o.name))}
    </ScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  bar: { flexDirection: rowDirectionStart, gap: spacing.sm, paddingHorizontal: spacing.base, paddingVertical: spacing.sm },
  pill: {
    flexDirection: rowDirectionStart, alignItems: 'center', gap: spacing.xs,
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs, borderRadius: radius.full,
    backgroundColor: colors.surface,
  },
  dot: { width: 8, height: 8, borderRadius: radius.full },
  dotActive: { borderWidth: 2, borderColor: colors.textInverse },
  pillActive: { backgroundColor: colors.primary },
  pillText: { ...typography.bodySmall, ...typography.bold, color: colors.textSecondary },
  pillTextActive: { color: colors.textInverse },
}));
