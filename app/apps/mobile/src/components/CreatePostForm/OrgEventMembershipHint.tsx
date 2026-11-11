// Mapped to spec: docs/spec/08_organizations.md Events (D31), FR-ORG-002 (G18) — an organization's
// event is published by its members, so the time world's offer form tells someone who belongs to
// no organization how to get there: register one, or ask its admin to add them.
import React from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { webTextRtl } from '../../lib/webRtlStyle';

export function OrgEventMembershipHint() {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useStyles();
  return (
    <View style={styles.hint} testID="org-event-membership-hint">
      <Text style={[styles.text, webTextRtl]}>{t('eventPost.create.membershipHint')}</Text>
      <Pressable
        testID="org-event-membership-hint-open"
        accessibilityRole="link"
        hitSlop={spacing.sm}
        onPress={() => router.push('/settings/organizations')}
      >
        <Text style={[styles.link, webTextRtl]}>{t('eventPost.create.membershipHintCta')}</Text>
      </Pressable>
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  hint: { gap: spacing.xs, paddingVertical: spacing.sm },
  text: { ...typography.caption, color: colors.textSecondary },
  link: { ...typography.caption, ...typography.semiBold, color: colors.primary },
}));
