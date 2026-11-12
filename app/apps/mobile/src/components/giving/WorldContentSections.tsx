// FR-FEED-020 AC2 / FR-DONATE-011 / FR-KNOW-001 — the curated part of a world's "links and
// knowledge" screen: the organizations the world works through, the related worlds, and the
// world's knowledge topics. Presentational: the caller reads the content (`useWorldContent`).
// A section with no row is not rendered.
import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { buildKnowledgeTopicTree, localizedWorldLabel, type WorldContent } from '@kc/domain';
import { makeUseStyles, spacing, typography, Text } from '@kc/ui';
import { givingWorldHref } from '../../navigation/donationsHubTiles';
import { openExternalUrl } from '../../utils/openExternalUrl';
import { rowDirectionStart } from '../../lib/rtlLayout';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { Chip } from '../ui/Chip';
import { WorldContentRow } from './WorldContentRow';

const useStyles = makeUseStyles(({ colors }) => ({
  container: { gap: spacing.xl },
  section: { gap: spacing.sm },
  sectionTitle: { ...typography.h3, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  topic: { gap: spacing.xs },
  topicTitle: { ...typography.body, ...typography.semiBold, color: colors.textPrimary, textAlign: rtlTextAlignStart },
  chips: { flexDirection: rowDirectionStart, flexWrap: 'wrap' as const, gap: spacing.xs },
}));

/** Host of an address without the `www.` prefix, as the second line of an organization row. */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function WorldContentSections({ content }: { readonly content: WorldContent }) {
  const styles = useStyles();
  const router = useRouter();
  const { t, i18n } = useTranslation();
  const language = i18n.language;
  const topicTree = useMemo(() => buildKnowledgeTopicTree(content.topics), [content.topics]);

  return (
    <View style={styles.container} testID="world-content-sections">
      {content.externalBodies.length > 0 ? (
        <View style={styles.section} testID="world-content-bodies">
          <Text style={styles.sectionTitle}>{t('donations.worldContent.bodiesTitle')}</Text>
          {content.externalBodies.map((body) => (
            <WorldContentRow
              key={body.bodyId}
              testID={`world-content-body-${body.slug}`}
              title={localizedWorldLabel(body, language)}
              subtitle={body.contactUrl ? hostOf(body.contactUrl) : null}
              icon="open-outline"
              onPress={body.contactUrl ? () => openExternalUrl(body.contactUrl as string) : undefined}
            />
          ))}
        </View>
      ) : null}

      {content.links.length > 0 ? (
        <View style={styles.section} testID="world-content-related">
          <Text style={styles.sectionTitle}>{t('donations.worldContent.relatedTitle')}</Text>
          {content.links.map((link) => (
            <WorldContentRow
              key={link.linkId}
              testID={`world-content-link-${link.linkSlug}`}
              title={localizedWorldLabel(link, language)}
              subtitle={link.description}
              icon="chevron-back-outline"
              onPress={() => router.push(givingWorldHref(link.toWorldSlug))}
            />
          ))}
        </View>
      ) : null}

      {topicTree.length > 0 ? (
        <View style={styles.section} testID="world-content-topics">
          <Text style={styles.sectionTitle}>{t('donations.worldContent.topicsTitle')}</Text>
          {topicTree.map((root) => (
            <View key={root.topicId} style={styles.topic} testID={`world-content-topic-${root.slug}`}>
              <Text style={styles.topicTitle}>{localizedWorldLabel(root, language)}</Text>
              {root.children.length > 0 ? (
                <View style={styles.chips}>
                  {root.children.map((child) => (
                    <Chip key={child.topicId} variant="tag" size="sm" label={localizedWorldLabel(child, language)} />
                  ))}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}
