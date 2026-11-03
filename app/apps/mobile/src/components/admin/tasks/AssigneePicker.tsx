// app/apps/mobile/src/components/admin/tasks/AssigneePicker.tsx
// FR-ADMIN-018 — pick an assignee from active admins (uses admin_list_admins RPC).
// Visible only when the caller has admins.view permission (super_admin/moderator).
import { useQuery } from '@tanstack/react-query';
import { ScrollView, View } from 'react-native';
import { adminChipScroll } from '../adminChipScroll';
import type { AdminGrant } from '@kc/domain';
import { makeUseStyles, spacing } from '@kc/ui';
import { Chip } from '../../ui/Chip';
import { container } from '../../../lib/container';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface AssigneePickerProps {
  readonly value: string | null;
  readonly onChange: (assigneeId: string | null) => void;
}

interface PickEntry {
  readonly userId: string;
  readonly displayName: string;
  readonly role: AdminGrant['role'];
}

export function AssigneePicker({ value, onChange }: AssigneePickerProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const q = useQuery({
    queryKey: ['admin.admins.list', { includeRevoked: false }],
    queryFn:  () => container.listAdmins.execute({ includeRevoked: false }),
    staleTime: 60_000,
  });
  const entries = derivePickEntries(q.data ?? [], L.admin.admins.row.unnamed);

  return (
    <View>
      <ScrollView horizontal style={adminChipScroll.scroll} showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.row, adminChipScroll.content]}>
        <Chip
          label={L.admin.tasks.form.unassigned}
          selected={value === null}
          onPress={() => onChange(null)}
          size="sm"
        />
        {entries.map((e) => (
          <Chip
            key={e.userId}
            label={e.displayName}
            selected={value === e.userId}
            onPress={() => onChange(e.userId)}
            size="sm"
          />
        ))}
      </ScrollView>
    </View>
  );
}

function derivePickEntries(
  grants: readonly AdminGrant[],
  unnamedLabel: string,
): readonly PickEntry[] {
  const seen = new Set<string>();
  const out: PickEntry[] = [];
  for (const g of grants) {
    if (g.revokedAt !== null) continue;
    if (seen.has(g.userId)) continue;
    seen.add(g.userId);
    out.push({
      userId: g.userId,
      displayName: g.displayName ?? unnamedLabel,
      role: g.role,
    });
  }
  return out;
}

const useStyles = makeUseStyles(() => ({
  row: { gap: spacing.sm, paddingVertical: spacing.xs },
}));
