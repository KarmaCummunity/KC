// Report sheet for a marketplace listing (shared `ReportSheet`).
import React from 'react';
import { useTranslation } from 'react-i18next';
import { container } from '../../lib/container';
import { ReportSheet } from '../report/ReportSheet';

interface Props {
  listingId: string;
  visible: boolean;
  onClose: () => void;
}

export function ReportListingModal({ listingId, visible, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <ReportSheet
      visible={visible}
      onClose={onClose}
      copy={{
        title: t('marketplace.reportTitle'),
        noteLabel: t('post.reportNotePlaceholder'),
        submitLabel: t('post.reportSubmit'),
        cancelLabel: t('common.cancel'),
      }}
      fileReport={(reporterId, reason, note) => container.reportListing.execute({ reporterId, listingId, reason, note })}
    />
  );
}
