// FR-DONATE-008/009 — sheet for adding or editing community NGO links.
// Kit `BottomSheet` + `TextField`s; the submit leads the footer (spec 17 §4.1).
import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DonationCategorySlug, DonationLink } from '@kc/domain';
import { BottomSheet } from './ui/BottomSheet';
import { GhostButton, PrimaryButton } from './ui/Buttons';
import { DonationLinkFields } from './DonationLinkFields';
import { useAddOrEditDonationLinkModal } from './useAddOrEditDonationLinkModal';

interface Props {
  readonly visible: boolean;
  readonly categorySlug: DonationCategorySlug;
  readonly editingLink: DonationLink | null;
  readonly onClose: () => void;
  readonly onAdded: (link: DonationLink) => void;
  readonly onUpdated: (link: DonationLink) => void;
}

export function AddDonationLinkModal(props: Readonly<Props>) {
  const { t } = useTranslation();
  const { url, setUrl, name, setName, desc, setDesc, fieldErrors, isEdit, submitting, errorKey, handleClose, submit } =
    useAddOrEditDonationLinkModal(props);

  const submitLabel = isEdit ? t('donations.addLinkModal.save') : t('donations.addLinkModal.submit');

  return (
    <BottomSheet
      visible={props.visible}
      onDismiss={handleClose}
      title={isEdit ? t('donations.addLinkModal.editTitle') : t('donations.addLinkModal.title')}
      footer={
        <>
          <PrimaryButton
            label={submitting ? t('donations.addLinkModal.submitting') : submitLabel}
            size="md"
            fullWidth
            onPress={() => void submit()}
            disabled={submitting}
          />
          <GhostButton
            label={t('donations.addLinkModal.cancel')}
            size="md"
            fullWidth
            onPress={handleClose}
            disabled={submitting}
          />
        </>
      }
    >
      <DonationLinkFields
        url={url}
        setUrl={setUrl}
        name={name}
        setName={setName}
        desc={desc}
        setDesc={setDesc}
        isEdit={isEdit}
        submitting={submitting}
        errorKey={errorKey}
        fieldErrors={fieldErrors}
      />
    </BottomSheet>
  );
}
