// FR-KNOW-012 AC2 — official body links for a knowledge shelf, plus the D40 notice on
// the rights & legal aid shelf.
import React, { useCallback } from 'react';
import { Alert, Linking, Pressable, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { iconSize, makeUseStyles, spacing, typography, useTheme, Text } from '@kc/ui';
import { localizedWorldLabel, type KnowledgeShelfSlug } from '@kc/domain';
import { useKnowledgeShelfLinks } from '../../../hooks/useKnowledgeShelfLinks';
import { KnowledgeAdviceNotice } from './KnowledgeAdviceNotice';
import { rtlTextAlignStart, rowDirectionStart } from '../../../lib/rtlLayout';

interface Props {
  readonly shelfSlug: KnowledgeShelfSlug;
  /** When true, also show the D40 notice above the links (rights shelf non-consulting posts). */
  readonly showNotice?: boolean;
}

export function KnowledgeShelfLinksSection({ shelfSlug, showNotice = false }: Props) {
  const { t, i18n } = useTranslation();
  const { colors } = useTheme();
  const styles = useStyles();
  const { links } = useKnowledgeShelfLinks(shelfSlug);

  const openLink = useCallback(
    async (url: string) => {
      try {
        if (!(await Linking.canOpenURL(url))) throw new Error('unsupported_url');
        await Linking.openURL(url);
      } catch {
        Alert.alert(t('knowledgeTrust.shelfLinks.linkError'));
      }
    },
    [t],
  );

  if (!showNotice && links.length === 0) return null;

  return (
    <View style={styles.wrap} testID="knowledge-shelf-links">
      {showNotice ? <KnowledgeAdviceNotice testID="rights-shelf-advice-notice" /> : null}
      {links.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.title}>{t('knowledgeTrust.shelfLinks.title')}</Text>
          {links.map((link) => {
            const name = localizedWorldLabel(link, i18n.language);
            return (
              <Pressable
                key={link.linkId}
                accessibilityRole="link"
                accessibilityLabel={t('knowledgeTrust.shelfLinks.openA11y', { name })}
                testID={`knowledge-shelf-link-${link.linkSlug}`}
                onPress={() => void openLink(link.url)}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Text style={styles.linkName}>{name}</Text>
                <Ionicons name="open-outline" size={iconSize.md} color={colors.textSecondary} />
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  wrap: { gap: spacing.md, marginTop: spacing.sm },
  list: { gap: spacing.sm },
  title: {
    ...typography.h3,
    color: colors.textPrimary,
    textAlign: rtlTextAlignStart,
  },
  row: {
    flexDirection: rowDirectionStart,
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 44,
    paddingVertical: spacing.sm,
  },
  pressed: { opacity: 0.85 },
  linkName: {
    ...typography.body,
    color: colors.primary,
    flex: 1,
    textAlign: rtlTextAlignStart,
    textDecorationLine: 'underline' as const,
  },
}));
