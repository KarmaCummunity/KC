import { useEffect, useMemo, useState } from 'react';
import { View, ScrollView, ActivityIndicator, Platform, type DimensionValue } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { useTranslation } from 'react-i18next';
import type { LegalDocType, LegalDocumentContent } from '@kc/domain';
import { typography, spacing, radius, useTheme, Text } from '@kc/ui';
import { getLoadLegalDocumentUseCase } from '../../services/legalComposition';
import { makeLegalMarkdownStyles } from './LegalMarkdownStyles';
import { makeLegalMarkdownRules } from './legalMarkdownRules';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { layoutWritingDirectionStyle, selfAlignStart } from '../../lib/rtlLayout';

function formatHebrewDate(d: Date): string {
  // DD.MM.YYYY per spec §7.1
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

interface LegalDocumentReaderProps {
  readonly docType: LegalDocType;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; content: LegalDocumentContent }
  | { kind: 'error' };

export function LegalDocumentReader({ docType }: LegalDocumentReaderProps) {
  const { colors } = useTheme();
  const { t } = useTranslation();
  const markdownStyles = useMemo(() => makeLegalMarkdownStyles(colors), [colors]);
  const markdownRules = useMemo(() => makeLegalMarkdownRules(colors), [colors]);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const content = await getLoadLegalDocumentUseCase().execute({ docType });
        if (!cancelled) setState({ kind: 'ready', content });
      } catch {
        if (!cancelled) setState({ kind: 'error' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [docType]);

  if (state.kind === 'loading') {
    return <LoadingSkeleton bgColor={colors.surfaceRaised} />;
  }

  if (state.kind === 'error') {
    return (
      <View style={{ padding: spacing.lg, backgroundColor: colors.background, flex: 1 }}>
        <Text
          style={{
            ...typography.body,
            color: colors.textPrimary,
            textAlign: rtlTextAlignStart,
            ...layoutWritingDirectionStyle(),
          }}
        >
          {t('legal.loadFailed')}
        </Text>
      </View>
    );
  }

  const { content } = state;
  const isFutureDated = content.effectiveDate.getTime() > Date.now();
  const containerStyle =
    Platform.OS === 'web'
      ? ({ maxWidth: 720, alignSelf: 'center', width: '100%' } as const)
      : undefined;

  return (
    <ScrollView
      style={{ backgroundColor: colors.background }}
      contentContainerStyle={[{ padding: spacing.lg }, containerStyle]}
    >
      <View style={{ marginBottom: spacing.md }}>
        <Text
          accessibilityRole="header"
          style={{
            ...typography.h2,
            color: colors.textPrimary,
            textAlign: rtlTextAlignStart,
            ...layoutWritingDirectionStyle(),
          }}
        >
          {docType === 'terms' ? t('legal.termsTitle') : t('legal.privacyTitle')}
        </Text>
        <Text
          style={{
            ...typography.caption,
            color: colors.textSecondary,
            textAlign: rtlTextAlignStart,
            ...layoutWritingDirectionStyle(),
            marginTop: spacing.xs,
          }}
        >
          {isFutureDated
            ? t('legal.futureEffective', { date: formatHebrewDate(content.effectiveDate) })
            : t('legal.effectiveDate', { date: formatHebrewDate(content.effectiveDate) })}
          {'  ·  '}
          {t('legal.versionChip', { version: content.version })}
        </Text>
      </View>

      <Markdown style={markdownStyles} rules={markdownRules}>
        {content.bodyMd}
      </Markdown>
    </ScrollView>
  );
}

function LoadingSkeleton({ bgColor }: Readonly<{ bgColor: string }>) {
  // `selfAlignStart` ('flex-start') resolves to the cross-axis start edge —
  // which under `I18nManager.forceRTL(true)` on native and `dir="rtl"` on web
  // is the visual RIGHT, matching the alignment of the loaded Hebrew body.
  const bar = (width: DimensionValue, marginTop: number) => (
    <View
      style={{
        alignSelf: selfAlignStart,
        width,
        height: 14,
        backgroundColor: bgColor,
        borderRadius: radius.xs,
        marginTop,
      }}
    />
  );
  return (
    <View style={{ padding: spacing.lg }}>
      {bar('40%', 0)}
      {bar('60%', spacing.md)}
      {bar('55%', spacing.md)}
      {bar('90%', spacing.lg)}
      {bar('85%', spacing.xs)}
      {bar('80%', spacing.xs)}
      {bar('70%', spacing.xs)}
      {bar('90%', spacing.lg)}
      {bar('85%', spacing.xs)}
      {bar('80%', spacing.xs)}
      {bar('70%', spacing.xs)}
      <ActivityIndicator style={{ alignSelf: selfAlignStart, marginTop: spacing.lg }} />
    </View>
  );
}
