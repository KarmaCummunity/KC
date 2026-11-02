// Shared compact publish action for every create-form category (spec 17 §4.1).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { PrimaryButton } from '../ui/Buttons';

interface Props {
  readonly onPress: () => void;
  readonly loading: boolean;
  readonly disabled?: boolean;
}

export function CreateFormHeaderPublishAction({ onPress, loading, disabled = false }: Props) {
  const { t } = useTranslation();
  return (
    <PrimaryButton
      testID="create-header-publish"
      label={t('post.publish')}
      size="sm"
      onPress={onPress}
      loading={loading}
      disabled={disabled}
      haptic={false}
    />
  );
}
