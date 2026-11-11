// app/apps/mobile/src/components/admin/admins/UserLookupField.tsx
// FR-ADMIN-016 — debounced active-user lookup for the grant modal. Queries
// `users` directly (RLS lets any signed-in viewer read active rows, D-21);
// once a user is picked the field collapses into the selection with a
// "change" link.
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { TextField } from '../../ui/TextField';
import { legacySupabase as supabase } from '../../../lib/container';
import { rowDirectionStart, textAlignStart } from '../../../lib/rtlLayout';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

/** A user the grant applies to. */
export interface PickedUser {
  readonly userId: string;
  readonly displayName: string | null;
}

/** Debounce between keystrokes and the lookup, in ms. */
const LOOKUP_DEBOUNCE_MS = 280;
/** Characters needed before the lookup runs. */
const MIN_QUERY = 2;

async function lookupUsers(q: string): Promise<readonly PickedUser[]> {
  const trimmed = q.trim();
  if (trimmed.length < MIN_QUERY) return [];
  const { data, error } = await supabase
    .from('users')
    .select('user_id, display_name')
    .eq('account_status', 'active')
    .ilike('display_name', `%${trimmed}%`)
    .limit(8);
  if (error || !Array.isArray(data)) return [];
  return (data as { user_id: string; display_name: string | null }[])
    .map((r) => ({ userId: r.user_id, displayName: r.display_name }));
}

export interface UserLookupFieldProps {
  readonly selected: PickedUser | null;
  readonly onSelect: (user: PickedUser | null) => void;
  /** False when the user is fixed by the caller (the person screen). */
  readonly changeable: boolean;
}

export function UserLookupField({ selected, onSelect, changeable }: UserLookupFieldProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const copy = L.admin.admins.grantModal;
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<readonly PickedUser[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (selected) return;
    let cancelled = false;
    setLoading(true);
    const handle = setTimeout(async () => {
      const found = await lookupUsers(query);
      if (!cancelled) {
        setMatches(found);
        setLoading(false);
      }
    }, LOOKUP_DEBOUNCE_MS);
    return () => { cancelled = true; clearTimeout(handle); setLoading(false); };
  }, [query, selected]);

  if (selected) {
    return (
      <View style={styles.selectedRow}>
        <Text style={styles.selectedName} numberOfLines={1}>
          {selected.displayName ?? L.admin.admins.row.unnamed}
        </Text>
        {changeable && (
          <Pressable accessibilityRole="button" onPress={() => { onSelect(null); setQuery(''); }}>
            <Text style={styles.changeLink}>{copy.changeUser}</Text>
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <View>
      <TextField
        label=""
        value={query}
        onChangeText={setQuery}
        placeholder={copy.searchPlaceholder}
        autoCapitalize="none"
        autoCorrect={false}
        leadingIcon="search"
      />
      {loading && <ActivityIndicator style={styles.spinner} />}
      {!loading && query.trim().length >= MIN_QUERY && matches.length === 0 && (
        <Text style={styles.hint}>{copy.noMatches}</Text>
      )}
      {matches.map((m) => (
        <Pressable key={m.userId} accessibilityRole="button" style={styles.matchRow} onPress={() => onSelect(m)}>
          <Text style={styles.matchName} numberOfLines={1}>{m.displayName ?? L.admin.admins.row.unnamed}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  spinner:      { marginTop: spacing.sm },
  selectedRow: {
    flexDirection: rowDirectionStart, alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: spacing.md, paddingHorizontal: spacing.md,
    backgroundColor: colors.secondaryLight, borderRadius: radius.sm,
  },
  selectedName: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, flex: 1 },
  changeLink:   { ...typography.caption, ...typography.semiBold, color: colors.primary },
  hint:         { ...typography.caption, color: colors.textSecondary, marginTop: spacing.sm, textAlign: 'center' },
  matchRow: {
    paddingVertical: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  matchName:    { ...typography.body, color: colors.textPrimary, textAlign: textAlignStart() },
}));
