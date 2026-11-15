// app/apps/mobile/src/components/admin/admins/layers/AdminsLayersView.tsx
// FR-ADMIN-028 — the "layers" tab of the admins screen.
//
// Renders the whole management structure as levels of the reporting chain —
// as many as the data holds — standing on the masked community base. Every
// organisation has a colour that follows its people through every level; the
// org chips focus the view on one org without refetching (the fold is
// in-memory).
import { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import type { HierarchyPyramid } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography, useTheme } from '@kc/ui';
import { PrimaryButton } from '../../../ui/Buttons';
import { useHierarchyPyramid } from '../../../../hooks/useHierarchyPyramid';
import { SimpleRowListSkeleton } from '../../../skeletons/SimpleRowListSkeleton';
import { MotionEntry } from '../../../ui/MotionEntry';
import { OrgSwitcher } from '../OrgSwitcher';
import { HierarchyStatsStrip } from './HierarchyStatsStrip';
import { HierarchyLayerBand } from './HierarchyLayerBand';
import { MaskedCommunityBand } from './MaskedCommunityBand';
import { OrgSlugCard } from './OrgSlugCard';
import { buildOrgAccents, layerPhoneInset, layerWidePct } from './layerVisuals';
import { useLocaleBundle } from '../../../../i18n/useLocaleBundle';

/** Stagger between consecutive bands of the entry animation, in ms. */
const BAND_STAGGER_MS = 80;

export interface AdminsLayersViewProps {
  readonly isWide: boolean;
  readonly onSelect: (userId: string) => void;
  /** The viewer is the super admin, who alone changes an organization's page slug. */
  readonly canChangeSlug?: boolean;
}

/** Wide screens: bands taper into a pyramid. */
function wideBandStyle(index: number, total: number) {
  return { width: `${layerWidePct(index, total)}%` as const };
}

/** Phones: full-width bands with a gentle, capped inset toward the top. */
function phoneBandStyle(index: number, total: number) {
  return { alignSelf: 'stretch' as const, marginHorizontal: layerPhoneInset(index, total) };
}

interface PyramidBodyProps {
  readonly pyramid: HierarchyPyramid;
  readonly focusOrgId: string | null;
  readonly onFocus: (orgId: string | null) => void;
  readonly isWide: boolean;
  readonly onSelect: (userId: string) => void;
  readonly canChangeSlug: boolean;
}

function PyramidBody({ pyramid, focusOrgId, onFocus, isWide, onSelect, canChangeSlug }: PyramidBodyProps) {
  const styles = useStyles();
  const { colors } = useTheme();
  const L = useLocaleBundle();
  // `pyramid.orgs` always lists every visible org (independent of focus), so
  // accents and chip options stay stable while the user switches focus.
  const orgAccents = useMemo(() => buildOrgAccents(pyramid.orgs, colors.primary), [pyramid.orgs, colors.primary]);
  const verifiedOrgIds = useMemo(
    () => new Set(pyramid.orgs.filter((o) => o.isVerified).map((o) => o.orgId)),
    [pyramid.orgs],
  );
  const orgOptions = useMemo(() => pyramid.orgs.map((o) => ({ id: o.orgId, name: o.name })), [pyramid.orgs]);
  // The focused organization's page address; only the super admin may change it (FR-ORG-001 AC5).
  const focusedOrg = pyramid.orgs.find((o) => o.orgId === focusOrgId) ?? null;
  const total = pyramid.layers.length;

  return (
    <View style={styles.body}>
      <HierarchyStatsStrip
        communityTotal={pyramid.base.communityTotal}
        roleHolders={pyramid.visiblePeople}
        orgCount={pyramid.orgs.length}
        affiliated={pyramid.base.affiliatedCount}
      />
      {orgOptions.length > 1 && (
        <OrgSwitcher orgs={orgOptions} selected={focusOrgId} onSelect={onFocus} accents={orgAccents} />
      )}
      {canChangeSlug && focusedOrg !== null && focusedOrg.slug !== '' && <OrgSlugCard org={focusedOrg} />}
      <View style={styles.stack}>
        {total === 0 && <Text style={styles.emptyText}>{L.admin.admins.layers.empty}</Text>}
        {pyramid.layers.map((layer, i) => (
          <MotionEntry
            key={layer.level}
            delay={i * BAND_STAGGER_MS}
            style={[styles.bandSlot, isWide ? wideBandStyle(i, total) : phoneBandStyle(i, total)]}
          >
            <HierarchyLayerBand
              layer={layer}
              orgAccents={orgAccents}
              verifiedOrgIds={verifiedOrgIds}
              onSelect={onSelect}
            />
            <View style={styles.connector} importantForAccessibility="no" />
          </MotionEntry>
        ))}
        <MotionEntry delay={total * BAND_STAGGER_MS} style={[styles.bandSlot, styles.baseSlot]}>
          <MaskedCommunityBand base={pyramid.base} />
        </MotionEntry>
      </View>
    </View>
  );
}

export function AdminsLayersView({ isWide, onSelect, canChangeSlug = false }: AdminsLayersViewProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const [focusOrgId, setFocusOrgId] = useState<string | null>(null);
  const { pyramid, isRefetching, refetch, error } = useHierarchyPyramid(focusOrgId);

  // A refetch can drop the focused org (e.g. its last grant was revoked);
  // fall back to "all orgs" instead of rendering empty levels with no chip.
  useEffect(() => {
    if (focusOrgId !== null && pyramid !== null && !pyramid.orgs.some((o) => o.orgId === focusOrgId)) {
      setFocusOrgId(null);
    }
  }, [focusOrgId, pyramid]);

  // Branch on data, not on `isLoading`: while the persisted cache restores, a
  // query is pending without fetching, so "not loading" does not mean "failed".
  // Loaded data wins over an error: a failed background refetch keeps the last
  // good pyramid on screen instead of replacing it with the error state.
  let content;
  if (pyramid === null && error) {
    content = (
      <View style={styles.center}>
        <Text style={styles.errorText}>{L.admin.admins.layers.loadError}</Text>
        <PrimaryButton testID="admins-layers-retry" label={L.admin.admins.layers.retry} size="sm" onPress={refetch} />
      </View>
    );
  } else if (pyramid === null) {
    content = <SimpleRowListSkeleton rows={6} rowHeight={88} />;
  } else {
    content = (
      <PyramidBody
        pyramid={pyramid}
        focusOrgId={focusOrgId}
        onFocus={setFocusOrgId}
        isWide={isWide}
        onSelect={onSelect}
        canChangeSlug={canChangeSlug}
      />
    );
  }

  return (
    <ScrollView
      contentContainerStyle={[styles.content, isWide && styles.contentWide]}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      {content}
    </ScrollView>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  content:     { paddingHorizontal: spacing.base, paddingBottom: spacing['2xl'] },
  contentWide: { width: '100%', maxWidth: 960, alignSelf: 'center' },
  body:        { gap: spacing.md },
  stack:       { alignItems: 'center' },
  bandSlot:    { alignItems: 'center' },
  baseSlot:    { alignSelf: 'stretch' },
  connector:   { width: 2, height: 14, backgroundColor: colors.border, borderRadius: radius.full },
  center:      { alignItems: 'center', gap: spacing.md, paddingVertical: spacing['2xl'] },
  errorText:   { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
  emptyText:   { ...typography.bodySmall, color: colors.textSecondary, textAlign: 'center', paddingVertical: spacing.base },
}));
