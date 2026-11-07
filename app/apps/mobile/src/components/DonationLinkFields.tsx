// FR-DONATE-008/009 — the three fields of a community link (URL, display name, description),
// the approval helper and the error line. Shared by the add / edit sheet and by the create
// form of the link-only giving worlds, so both stay identical.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { DONATION_LINK_DESCRIPTION_MAX, DONATION_LINK_DISPLAY_NAME_MAX } from '@kc/domain';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { formUrlInputProps } from '../lib/platform/formTextInputHints';
import { TextField } from './ui/TextField';
import type { useAddOrEditDonationLinkModal } from './useAddOrEditDonationLinkModal';

type LinkFormState = ReturnType<typeof useAddOrEditDonationLinkModal>;

type Props = Readonly<
  Pick<LinkFormState, 'url' | 'setUrl' | 'name' | 'setName' | 'desc' | 'setDesc' | 'isEdit' | 'submitting' | 'errorKey'>
>;

export function DonationLinkFields({ url, setUrl, name, setName, desc, setDesc, isEdit, submitting, errorKey }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  return (
    <>
      <TextField
        label={t('donations.addLinkModal.urlLabel')}
        value={url}
        onChangeText={setUrl}
        placeholder={t('donations.addLinkModal.urlPlaceholder')}
        editable={!submitting}
        {...formUrlInputProps}
      />
      <TextField
        label={t('donations.addLinkModal.nameLabel')}
        value={name}
        onChangeText={setName}
        placeholder={t('donations.addLinkModal.namePlaceholder')}
        maxLength={DONATION_LINK_DISPLAY_NAME_MAX}
        editable={!submitting}
      />
      <TextField
        label={t('donations.addLinkModal.descriptionLabel')}
        value={desc}
        onChangeText={setDesc}
        placeholder={t('donations.addLinkModal.descriptionPlaceholder')}
        maxLength={DONATION_LINK_DESCRIPTION_MAX}
        multiline
        editable={!submitting}
      />
      <Text style={styles.helper}>
        {isEdit ? t('donations.addLinkModal.editHelperText') : t('donations.addLinkModal.helperText')}
      </Text>
      {errorKey ? (
        <Text style={styles.error} role="alert">
          {t(`donations.addLinkModal.errors.${errorKey}`, {
            defaultValue: t('donations.addLinkModal.errors.unknown'),
          })}
        </Text>
      ) : null}
    </>
  );
}

const useStyles = makeUseStyles(({ colors }) => ({
  helper: { ...typography.caption, color: colors.textSecondary, textAlign: rtlTextAlignStart },
  error: { ...typography.body, color: colors.error, textAlign: rtlTextAlignStart },
}));
