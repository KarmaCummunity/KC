import React, { useState } from 'react';
import { View, ActivityIndicator, Pressable } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { aboutRtlText, aboutRtlRow } from './aboutWebRtlStyle';
import { AvatarInitials } from '../../components/AvatarInitials';
import { useAboutTeamMembers } from '../../hooks/useAboutTeamMembers';

interface TeamRoleCopy {
  readonly role: string;
  readonly bio: string;
  readonly bioFull?: string;
}

const AVATAR = 56;

function resolveRoleCopy(
  roles: Record<string, TeamRoleCopy>,
  roleKey: string,
): TeamRoleCopy | null {
  const copy = roles[roleKey];
  if (!copy || typeof copy !== 'object') return null;
  return copy;
}

interface TeamCardProps {
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly shareHandle: string;
  readonly copy: TeamRoleCopy;
}

function TeamCard({ displayName, avatarUrl, shareHandle, copy }: TeamCardProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const styles = useAboutMissionTeamSectionStyles();
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const hasFullStory = typeof copy.bioFull === 'string' && copy.bioFull.length > 0;

  const goToProfile = () => router.push(`/user/${shareHandle}`);
  const toggleExpand = () => setExpanded((v) => !v);

  return (
    <View style={styles.card}>
      <Pressable
        onPress={goToProfile}
        accessibilityRole="button"
        accessibilityLabel={`${displayName} — ${copy.role}`}
        style={({ pressed }) => [styles.cardHeader, pressed && styles.cardPressed]}
      >
        <View style={styles.row}>
          <AvatarInitials name={displayName} avatarUrl={avatarUrl} size={AVATAR} />
          <View style={styles.meta}>
            <Text style={styles.name}>{displayName}</Text>
            <Text style={styles.role}>{copy.role}</Text>
          </View>
        </View>
      </Pressable>

      <Text style={styles.bio}>{copy.bio}</Text>

      {hasFullStory && expanded ? (
        <Text style={styles.bioFull}>{copy.bioFull}</Text>
      ) : null}

      <View style={styles.cardActions}>
        {hasFullStory ? (
          <Pressable
            onPress={toggleExpand}
            accessibilityRole="button"
            accessibilityLabel={
              expanded
                ? t('aboutContent.teamStoryExpandLess')
                : t('aboutContent.teamStoryExpandMore')
            }
            style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
            hitSlop={8}
          >
            <Ionicons
              name={expanded ? 'chevron-up' : 'chevron-down'}
              size={iconSize.sm}
              color={colors.primary}
            />
            <Text style={styles.actionText}>
              {expanded
                ? t('aboutContent.teamStoryExpandLess')
                : t('aboutContent.teamStoryExpandMore')}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          onPress={goToProfile}
          accessibilityRole="link"
          accessibilityLabel={t('aboutContent.teamProfileLinkLabel')}
          style={({ pressed }) => [styles.actionBtn, pressed && styles.actionBtnPressed]}
          hitSlop={8}
        >
          <Ionicons name="open-outline" size={iconSize.sm} color={colors.primary} />
          <Text style={styles.actionText}>{t('aboutContent.teamProfileLinkLabel')}</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function AboutMissionTeamSection() {
  const { t } = useTranslation();
  const styles = useAboutMissionTeamSectionStyles();
  const { members, loading, error, refetch } = useAboutTeamMembers();
  const roleCopy = t('aboutContent.teamRoles', { returnObjects: true }) as Record<string, TeamRoleCopy>;

  const visibleMembers = members
    .map((member) => {
      const copy = resolveRoleCopy(roleCopy, member.roleKey);
      if (!copy) return null;
      return { member, copy };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  return (
    <View>
      <Text style={styles.h}>{t('aboutContent.missionTeamTitle')}</Text>
      <Text style={styles.intro}>{t('aboutContent.missionTeamIntro')}</Text>

      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator />
        </View>
      ) : null}

      {!loading && error ? (
        <Pressable onPress={() => { refetch(); }} style={styles.errorBox}>
          <Text style={styles.errorText}>{t('aboutContent.teamLoadError')}</Text>
          <Text style={styles.errorRetry}>{t('general.retry')}</Text>
        </Pressable>
      ) : null}

      {!loading && !error && visibleMembers.length > 0 ? (
        <View style={styles.list}>
          {visibleMembers.map(({ member, copy }) => (
            <TeamCard
              key={member.roleKey}
              displayName={member.displayName}
              avatarUrl={member.avatarUrl}
              shareHandle={member.shareHandle}
              copy={copy}
            />
          ))}
        </View>
      ) : null}

      <View style={styles.ctaBox}>
        <Text style={styles.ctaH}>{t('aboutContent.teamPartnerCtaTitle')}</Text>
        <Text style={styles.ctaP}>{t('aboutContent.teamPartnerCtaBody')}</Text>
      </View>
    </View>
  );
}

const useAboutMissionTeamSectionStyles = makeUseStyles(({ colors }) => ({
  h: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText, marginBottom: spacing.sm },
  intro: { ...typography.body, color: colors.textSecondary, ...aboutRtlText, lineHeight: 24, marginBottom: spacing.lg },
  loadingRow: { alignItems: 'center', paddingVertical: spacing.lg },
  errorBox: {
    marginBottom: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.errorLight,
    borderWidth: 1,
    borderColor: colors.error,
    gap: spacing.xs,
  },
  errorText: { ...typography.caption, color: colors.textSecondary, ...aboutRtlText, lineHeight: 20 },
  errorRetry: { ...typography.label, color: colors.primary, ...aboutRtlText, ...typography.bold },
  list: { gap: spacing.md },
  card: {
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    backgroundColor: colors.surfaceRaised,
    gap: spacing.sm,
  },
  cardHeader: {
    marginBottom: spacing.xs,
  },
  cardPressed: {
    opacity: 0.85,
  },
  row: { flexDirection: aboutRtlRow, alignItems: 'center', gap: spacing.md },
  meta: { flex: 1, gap: spacing.xs },
  name: { ...typography.h4, color: colors.textPrimary, ...aboutRtlText },
  role: { ...typography.body, color: colors.primary, ...aboutRtlText, ...typography.bold },
  bio: { ...typography.body, color: colors.textSecondary, ...aboutRtlText, lineHeight: 22 },
  bioFull: {
    ...typography.body,
    color: colors.textPrimary,
    ...aboutRtlText,
    lineHeight: 26,
    paddingTop: spacing.sm,
    marginTop: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  cardActions: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingTop: spacing.xs,
  },
  actionBtn: {
    flexDirection: aboutRtlRow,
    alignItems: 'center',
    gap: spacing.xs,
  },
  actionBtnPressed: { opacity: 0.6 },
  actionText: {
    ...typography.label,
    color: colors.primary,
    ...aboutRtlText,
    ...typography.bold,
  },
  ctaBox: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.infoLight,
    borderWidth: 1,
    borderColor: colors.info,
    gap: spacing.xs,
  },
  ctaH: { ...typography.label, color: colors.textPrimary, ...aboutRtlText, ...typography.extraBold },
  ctaP: { ...typography.caption, color: colors.textSecondary, ...aboutRtlText, lineHeight: 20 },
}));
