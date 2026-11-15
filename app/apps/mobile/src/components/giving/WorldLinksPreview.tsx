// Mapped to spec: FR-FEED-020 AC2 / FR-DONATE-007 — the end of a giving world's feed: a short
// list of the world's community links and a button to the world's "links and knowledge"
// screen, where the full list, the organizations and the knowledge topics are. The feed stays
// the main content; the footer is the same in every world.
import React from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { SecondaryButton } from '../ui/Buttons';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { useWorldLinksPreview } from '../../hooks/useWorldLinksPreview';
import { WorldContentRow } from './WorldContentRow';
import { worldLinksSubScreenLink } from './worldSubScreens';

const useStyles = makeUseStyles(({ colors }) => ({
  section: { marginTop: spacing.lg, paddingHorizontal: spacing.lg, gap: spacing.sm },
  title: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  hint: { ...typography.body, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  button: { marginTop: spacing.xs },
}));

export function WorldLinksPreview({ worldSlug }: { readonly worldSlug: string }) {
  const styles = useStyles();
  const router = useRouter();
  const { t } = useTranslation();
  const links = useWorldLinksPreview(worldSlug);

  return (
    <View style={styles.section} testID="world-links-preview">
      <Text style={styles.title}>{t('donations.worldContent.title')}</Text>
      {links.length === 0 ? <Text style={styles.hint}>{t('donations.worldContent.previewHint')}</Text> : null}
      {links.map((link) => (
        <WorldContentRow
          key={link.id}
          testID="world-links-preview-row"
          title={link.displayName}
          subtitle={link.description}
          icon="open-outline"
          onPress={() => openExternalUrl(link.url)}
        />
      ))}
      <View style={styles.button}>
        <SecondaryButton
          testID="world-links-open-all"
          label={t('donations.worldContent.openAll')}
          size="md"
          icon="chevron-back-outline"
          onPress={() => router.push(worldLinksSubScreenLink(worldSlug).path)}
        />
      </View>
    </View>
  );
}
