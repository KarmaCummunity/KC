// FR-DONATE-008/009 — the three fields of a community link (URL, display name, description),
// the approval helper and the error line. Shared by the add / edit sheet and by the create
// form of the link-only giving worlds, so both stay identical.
import React from 'react';
import { useTranslation } from 'react-i18next';
import { DONATION_LINK_DESCRIPTION_MAX, DONATION_LINK_DISPLAY_NAME_MAX } from '@kc/domain';
import { makeUseStyles, typography, Text } from '@kc/ui';
import { rtlTextAlignStart } from '../lib/rtlTextAlignStart';
import { TextField } from './ui/TextField';
import type { useAddOrEditDonationLinkModal } from './useAddOrEditDonationLinkModal';

type LinkFormState = ReturnType<typeof useAddOrEditDonationLinkModal>;

type Props = Readonly<
  Pick<LinkFormState, 'url' | 'setUrl' | 'name' | 'setName' | 'desc' | 'setDesc' | 'isEdit' | 'submitting' | 'errorKey' | 'fieldErrors'>
>;

export function DonationLinkFields({ url, setUrl, name, setName, desc, setDesc, isEdit, submitting, errorKey, fieldErrors }: Props) {
  const { t } = useTranslation();
  const styles = useStyles();
  const problem = (key: string | undefined) => (key ? t(`createPostValidation.${key}`) : undefined);
  return (
    <>
      <TextField
        label={t('donations.addLinkModal.urlLabel')}
        value={url}
        onChangeText={setUrl}
        placeholder={t('donations.addLinkModal.urlPlaceholder')}
        editable={!submitting}
        inputKind="url"
        errorText={problem(fieldErrors.url)}
      />
      <TextField
        label={t('donations.addLinkModal.nameLabel')}
        value={name}
        onChangeText={setName}
        placeholder={t('donations.addLinkModal.namePlaceholder')}
        maxLength={DONATION_LINK_DISPLAY_NAME_MAX}
        editable={!submitting}
        errorText={problem(fieldErrors.name)}
      />
      <TextField
        label={t('donations.addLinkModal.descriptionLabel')}
        value={desc}
        onChangeText={setDesc}
        placeholder={t('donations.addLinkModal.descriptionPlaceholder')}
        maxLength={DONATION_LINK_DESCRIPTION_MAX}
        multiline
        editable={!submitting}
        errorText={problem(fieldErrors.desc)}
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
