// Mapped to spec: FR-IMPORT-007 AC2 — after an import the create form says it was filled from the
// pasted message, that contact details were taken out, and which fields the pipeline was unsure
// of, so the member checks them before publishing; FR-IMPORT-008 AC1 — and links the member's open
// post the import repeats. Nothing shows on a form opened without an import.
import React from 'react';
import { TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, radius, spacing, typography, useTheme, Text } from '@kc/ui';
import { useImportDraftStore } from '../../store/importDraftStore';

/** Field names the pipeline can flag; anything else it sends is not shown (no copy for it). */
const KNOWN_FIELDS = ['world', 'direction', 'subcategory', 'title', 'city', 'street', 'time', 'origin', 'destination'] as const;
type KnownField = (typeof KNOWN_FIELDS)[number];
const isKnownField = (name: string): name is KnownField => (KNOWN_FIELDS as readonly string[]).includes(name);

const useStyles = makeUseStyles(({ colors }) => ({
  box: {
    flexDirection: 'row' as const,
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceRaised,
  },
  lines: { flex: 1, gap: spacing.xs },
  title: { ...typography.body, color: colors.textPrimary },
  line: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.caption, ...typography.bold, color: colors.primary },
}));

export function ImportReviewNotice() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const router = useRouter();
  const review = useImportDraftStore((s) => s.review);
  if (!review) return null;

  const fields = review.confirmFields.filter(isKnownField).map((f) => t(`postImport.fields.${f}`));
  return (
    <View style={styles.box} testID="import-review-notice" accessibilityRole="summary">
      <Ionicons name="information-circle-outline" size={iconSize.md} color={colors.textSecondary} />
      <View style={styles.lines}>
        <Text style={styles.title}>{t('postImport.reviewTitle')}</Text>
        {fields.length > 0 ? (
          <Text style={styles.line} testID="import-review-check">{t('postImport.reviewCheck', { fields: fields.join(', ') })}</Text>
        ) : null}
        {review.removedContacts ? <Text style={styles.line} testID="import-review-removed">{t('postImport.reviewRemoved')}</Text> : null}
        {review.truncated ? <Text style={styles.line} testID="import-review-truncated">{t('postImport.reviewTruncated')}</Text> : null}
        {review.limit ? <Text style={styles.line} testID="import-review-limit">{t(`postImport.limits.${review.limit}`)}</Text> : null}
        {review.duplicatePostId ? (
          // FR-IMPORT-008 AC1: publishing anyway is allowed; the member may prefer the post they have.
          <TouchableOpacity
            testID="import-review-duplicate"
            accessibilityRole="link"
            onPress={() => router.push(`/post/${review.duplicatePostId}`)}
          >
            <Text style={styles.line}>{t('postImport.reviewDuplicate')}</Text>
            <Text style={styles.link}>{t('postImport.reviewDuplicateOpen')}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}
