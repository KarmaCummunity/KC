// app/apps/mobile/src/components/admin/reports/CaseTargetCard.tsx
// V2-ADMIN-REPORTS-4 — friendly target preview for the case-detail screen.
//
// Replaces the previous `Object.entries(target).map(...)` raw dump (which
// exposed snake-case keys to admins) with a typed render per target type:
//
//   post → preview snippet + status badge + "Open post" quick-link
//   user → display name + account-status badge + "Open profile" quick-link
//   comment → text snippet + status badge + author and post quick-links
//   chat → hidden/active label (no link — chats are private; we link to
//          the reporter side from the reporter list instead)
import { router } from 'expo-router';
import { Pressable, StyleSheet, View } from 'react-native';
import type { AdminReportTargetType } from '@kc/domain';
import { makeUseStyles, radius, spacing, Text, typography } from '@kc/ui';
import { PrimaryButton } from '../../ui/Buttons';
import { useLocaleBundle } from '../../../i18n/useLocaleBundle';

export interface CaseTargetCardProps {
  readonly targetType: AdminReportTargetType;
  readonly targetId: string;
  readonly target: Readonly<Record<string, unknown>>;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function fmtIso(iso: string | null): string | null {
  if (iso === null) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleString('he-IL');
}

export function CaseTargetCard({ targetType, targetId, target }: CaseTargetCardProps) {
  const styles = useStyles();
  const L = useLocaleBundle();
  const t = L.admin.caseDetail.targetCard;

  if (targetType === 'post') {
    const preview  = asString(target['preview']);
    const status   = asString(target['status']);
    const authorId = asString(target['author_id']);
    const created  = fmtIso(asString(target['created_at']));
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.kind}>{t.postKind}</Text>
          {status && <Badge label={status} />}
        </View>
        <Text style={styles.preview} numberOfLines={4}>
          {preview && preview.length > 0 ? preview : t.noPreview}
        </Text>
        <View style={styles.metaRow}>
          {authorId && (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push(`/user/${authorId}`)}
            >
              <Text style={styles.link}>{t.openAuthor}</Text>
            </Pressable>
          )}
          {created && <Text style={styles.metaText}>{t.createdAt(created)}</Text>}
        </View>
        <View style={styles.primaryBtn}>
          <PrimaryButton testID="case-target-open-post" label={t.openPost} size="sm" onPress={() => router.push(`/post/${targetId}`)} />
        </View>
      </View>
    );
  }

  if (targetType === 'comment') {
    const preview  = asString(target['preview']);
    const status   = asString(target['status']);
    const authorId = asString(target['author_id']);
    const postId   = asString(target['post_id']);
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.kind}>{t.commentKind}</Text>
          {status && <Badge label={status} />}
        </View>
        <Text style={styles.preview} numberOfLines={4}>
          {preview && preview.length > 0 ? preview : t.noPreview}
        </Text>
        {authorId && (
          <Pressable accessibilityRole="button" onPress={() => router.push(`/user/${authorId}`)}>
            <Text style={styles.link}>{t.openAuthor}</Text>
          </Pressable>
        )}
        {postId && (
          <View style={styles.primaryBtn}>
            <PrimaryButton testID="case-target-open-post" label={t.openPost} size="sm" onPress={() => router.push(`/post/${postId}`)} />
          </View>
        )}
      </View>
    );
  }

  if (targetType === 'user') {
    const displayName = asString(target['display_name']);
    const status      = asString(target['status']);
    const created     = fmtIso(asString(target['created_at']));
    return (
      <View style={styles.card}>
        <View style={styles.headerRow}>
          <Text style={styles.kind}>{t.userKind}</Text>
          {status && <Badge label={status} />}
        </View>
        <Text style={styles.preview}>{displayName ?? t.unnamedUser}</Text>
        {created && <Text style={styles.metaText}>{t.signedUpAt(created)}</Text>}
        <View style={styles.primaryBtn}>
          <PrimaryButton testID="case-target-open-profile" label={t.openProfile} size="sm" onPress={() => router.push(`/user/${targetId}`)} />
        </View>
      </View>
    );
  }

  // chat
  const removedAt = fmtIso(asString(target['removed_at']));
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Text style={styles.kind}>{t.chatKind}</Text>
        <Badge label={removedAt ? t.chatRemoved : t.chatActive} />
      </View>
      <Text style={styles.metaText}>
        {removedAt ? t.removedAt(removedAt) : t.chatNoLink}
      </Text>
    </View>
  );
}

function Badge({ label }: { readonly label: string }) {
  const styles = useStyles();
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  card: {
    padding: spacing.md, gap: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border,
  },
  headerRow:    { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, justifyContent: 'space-between' },
  kind:         { fontSize: typography.bodySmall.fontSize, ...typography.bold, opacity: 0.6 },
  badge:        { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radius.xs, backgroundColor: colors.secondaryLight },
  badgeText:    { fontSize: typography.caption.fontSize, ...typography.bold, color: colors.textPrimary },
  preview:      { fontSize: typography.body.fontSize, lineHeight: 20 },
  metaRow:      { flexDirection: 'row', gap: spacing.md, alignItems: 'center', flexWrap: 'wrap' },
  metaText:     { fontSize: typography.bodySmall.fontSize, opacity: 0.65 },
  link:         { fontSize: typography.bodySmall.fontSize, color: colors.primary, textDecorationLine: 'underline' },
  // Compact admin size (spec 17 §4.3), kept at its own width.
  primaryBtn:   { alignSelf: 'flex-start' },
}));
