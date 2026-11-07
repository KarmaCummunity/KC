import { useEffect, useState } from 'react';
import { View, Pressable } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { LegalDocumentContent, LegalPendingItem } from '@kc/domain';
import { typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { getLoadLegalDocumentUseCase } from '../../services/legalComposition';
import { layoutWritingDirectionStyle, rowDirectionStart } from '../../lib/rtlLayout';
import { hebrewContentTextStyle } from '../../lib/hebrewContentDirection';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';

interface LegalConsentCardProps {
  readonly item: LegalPendingItem;
  readonly checked: boolean;
  readonly onToggle: (v: boolean) => void;
  readonly onOpenReader: () => void;
}

const DOC_CHECKBOX_TEST_IDS = {
  terms: { testID: 'legal-consent-terms-checkbox' },
  privacy: { testID: 'legal-consent-privacy-checkbox' },
} as const;

export function LegalConsentCard({ item, checked, onToggle, onOpenReader }: LegalConsentCardProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const title = item.docType === 'terms' ? t('legal.termsTitle') : t('legal.privacyTitle');
  const checkboxLabel =
    item.docType === 'terms' ? t('legal.checkboxTerms') : t('legal.checkboxPrivacy');
  const [content, setContent] = useState<LegalDocumentContent | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const c = await getLoadLegalDocumentUseCase().execute({ docType: item.docType });
        if (!cancelled) setContent(c);
      } catch {
        // Cache fallback handles offline; nothing else to do on hard failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [item.docType]);

  const bullets = content?.changeSummary
    ? content.changeSummary
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('-'))
        .map((l) => l.replace(/^-\s*/, ''))
        .slice(0, 3)
    : [];

  return (
    <View
      style={{
        backgroundColor: colors.surfaceRaised,
        borderRadius: radius.md,
        padding: spacing.md,
        marginBottom: spacing.md,
      }}
    >
      <Text
        style={{
          ...typography.h4,
          color: colors.textPrimary,
          textAlign: rtlTextAlignStart,
          ...layoutWritingDirectionStyle(),
        }}
      >
        {title}
      </Text>

      {bullets.length > 0 ? (
        <View style={{ marginTop: spacing.sm }}>
          {bullets.map((b) => (
            <Text
              key={b}
              style={{
                ...typography.body,
                color: colors.textPrimary,
                ...hebrewContentTextStyle(),
                marginBottom: spacing.xs,
                lineHeight: 22,
              }}
            >
              {`• ${b}`}
            </Text>
          ))}
        </View>
      ) : null}

      <Pressable onPress={onOpenReader} style={{ marginTop: spacing.sm }}>
        <Text
          style={{
            ...typography.body,
            color: colors.primary,
            textAlign: rtlTextAlignStart,
            ...layoutWritingDirectionStyle(),
          }}
        >
          {t('legal.cardOpenFull')}
        </Text>
      </Pressable>

      <Pressable
        testID={DOC_CHECKBOX_TEST_IDS[item.docType as keyof typeof DOC_CHECKBOX_TEST_IDS]?.testID}
        accessibilityRole="checkbox"
        accessibilityState={{ checked }}
        onPress={() => onToggle(!checked)}
        style={{
          // `rowDirectionStart` (= 'row' on native, 'row-reverse' on web)
          // gives the same visual on both: checkbox on the right (inline-start
          // in RTL), label running right-to-left next to it. Writing
          // 'row-reverse' directly on native is a double-flip under
          // I18nManager.forceRTL → checkbox would jump to the LEFT.
          flexDirection: rowDirectionStart,
          alignItems: 'center',
          marginTop: spacing.md,
          gap: spacing.sm,
        }}
      >
        <View
          style={{
            width: 22,
            height: 22,
            borderRadius: radius.xs,
            borderWidth: 2,
            borderColor: colors.primary,
            backgroundColor: checked ? colors.primary : 'transparent',
          }}
        />
        <Text
          style={{
            ...typography.body,
            color: colors.textPrimary,
            flex: 1,
            textAlign: rtlTextAlignStart,
            ...layoutWritingDirectionStyle(),
          }}
        >
          {checkboxLabel}
        </Text>
      </Pressable>
    </View>
  );
}
