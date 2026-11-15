// FR-ORG-001 AC5 (PM decision) — the page address of the organization the layers view is
// focused on, which only the super admin may change. Shown to the super admin only; the server
// (`admin_set_org_slug`) re-checks the role, the slug rule and that the slug is free.
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { isOrgHierarchyError, type HierarchyOrgSummary } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { GhostButton, PrimaryButton, SecondaryButton } from '../../../ui/Buttons';
import { TextField } from '../../../ui/TextField';
import { useSetOrgSlug } from '../../../../hooks/useSetOrgSlug';
import { rtlTextAlignStart } from '../../../../lib/rtlLayout';
import { useLocaleBundle, type LocaleBundle } from '../../../../i18n/useLocaleBundle';

type SlugErrors = LocaleBundle['admin']['admins']['orgSlug']['errors'];

/** Localized text of a refused change; unknown codes fall back. */
function slugErrorText(errors: SlugErrors, err: unknown): string {
  const code = isOrgHierarchyError(err) ? err.code : 'unknown';
  return code in errors ? errors[code as keyof SlugErrors] : errors.unknown;
}

export interface OrgSlugCardProps {
  readonly org: HierarchyOrgSummary;
}

export function OrgSlugCard({ org }: OrgSlugCardProps) {
  const styles = useStyles();
  const copy = useLocaleBundle().admin.admins.orgSlug;
  const setSlug = useSetOrgSlug();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);

  const save = async (slug: string) => {
    setError(undefined);
    try {
      await setSlug.mutateAsync({ orgId: org.orgId, slug });
      setDraft(null);
    } catch (err) {
      setError(slugErrorText(copy.errors, err));
    }
  };

  return (
    <View style={styles.card} testID="org-slug-card">
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.current}>{copy.current(org.slug)}</Text>
      {draft === null ? (
        <GhostButton testID="org-slug-change" label={copy.change} size="sm" onPress={() => setDraft(org.slug)} />
      ) : (
        <>
          <TextField
            testID="org-slug-input"
            label={copy.label}
            helperText={copy.hint}
            value={draft}
            onChangeText={setDraft}
            autoCapitalize="none"
            autoCorrect={false}
            errorText={error}
          />
          <View style={styles.actions}>
            <PrimaryButton testID="org-slug-save" label={copy.save} size="sm" loading={setSlug.isPending}
              onPress={() => { void save(draft); }} />
            <SecondaryButton label={copy.cancel} size="sm" disabled={setSlug.isPending}
              onPress={() => { setDraft(null); setError(undefined); }} />
          </View>
        </>
      )}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    padding: spacing.md, gap: spacing.xs, borderRadius: radius.md, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  title: { ...typography.label, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  current: { ...typography.bodySmall, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  actions: { flexDirection: 'row', gap: spacing.sm },
}));
