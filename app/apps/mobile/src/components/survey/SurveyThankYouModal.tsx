// Thank-you dialog — FR-RESEARCH-001 (public research finish), FR-SETTINGS-016 (in-app).
// Built on the kit `Modal` (spec 17 §4.1).
import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { makeUseStyles, radius, typography, useTheme, Text } from '@kc/ui';
import { webTextRtl } from '../../lib/webRtlStyle';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import { GhostButton, PrimaryButton } from '../ui/Buttons';
import { Modal } from '../ui/Modal';

export type SurveyThankYouVariant = 'inApp' | 'publicResearch';

type Props = Readonly<{
  visible: boolean;
  variant: SurveyThankYouVariant;
  onDismiss: () => void;
  onShare?: () => void;
}>;

/** Side of the round heart tile, in points (a layout size). */
const HEART_TILE_SIZE = 52;

export function SurveyThankYouModal({
  visible,
  variant,
  onDismiss,
  onShare,
}: Props): React.JSX.Element {
  const { t } = useTranslation();
  const styles = useStyles();
  const { colors } = useTheme();

  const isPublic = variant === 'publicResearch';
  const dismissLabel = isPublic ? t('research.thankYouModal.dismiss') : t('survey.thankYouModal.dismiss');
  const DismissButton = isPublic ? GhostButton : PrimaryButton;

  return (
    <Modal
      visible={visible}
      title={isPublic ? t('research.thankYouModal.title') : t('survey.thankYouModal.title')}
      onDismiss={onDismiss}
      footer={
        <>
          {isPublic && onShare ? (
            <PrimaryButton
              label={t('research.share.endSurveyCta')}
              icon="share-social-outline"
              size="md"
              fullWidth
              onPress={onShare}
            />
          ) : null}
          <DismissButton label={dismissLabel} size="md" fullWidth onPress={onDismiss} />
        </>
      }
    >
      <View style={styles.iconWrap}>
        <Ionicons
          name="heart"
          size={28} // brand-guard-allow: hero glyph above the copy (spec 17 §4.2)
          color={colors.primary}
        />
      </View>
      <Text style={styles.message}>
        {isPublic ? t('research.thankYouModal.message') : t('survey.thankYouModal.message')}
      </Text>
    </Modal>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  iconWrap: {
    width: HEART_TILE_SIZE,
    height: HEART_TILE_SIZE,
    borderRadius: radius.full,
    backgroundColor: colors.primarySurface,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  message: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: rtlTextAlignStart,
    ...webTextRtl,
  },
}));
