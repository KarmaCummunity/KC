// Form state + submit for AddDonationLinkModal (FR-DONATE-008/009).
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DonationCategorySlug, DonationLink } from '@kc/domain';
import {
  DONATION_LINK_DESCRIPTION_MAX,
  DONATION_LINK_DISPLAY_NAME_MAX,
  DONATION_LINK_URL_PATTERN,
} from '@kc/domain';
import { isDonationLinkError } from '@kc/application';
import { container } from '../lib/container';

interface Args {
  visible: boolean;
  categorySlug: DonationCategorySlug;
  editingLink: DonationLink | null;
  onClose: () => void;
  onAdded: (link: DonationLink) => void;
  onUpdated: (link: DonationLink) => void;
}

export function useAddOrEditDonationLinkModal({
  visible,
  categorySlug,
  editingLink,
  onClose,
  onAdded,
  onUpdated,
}: Args) {
  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const valid = useMemo(() => {
    if (!DONATION_LINK_URL_PATTERN.test(url.trim())) return false;
    const n = name.trim();
    if (n.length < 2 || n.length > DONATION_LINK_DISPLAY_NAME_MAX) return false;
    if (desc.trim().length > DONATION_LINK_DESCRIPTION_MAX) return false;
    return true;
  }, [url, name, desc]);

  const isEdit = editingLink !== null;

  useEffect(() => {
    if (!visible) return;
    if (editingLink) {
      setUrl(editingLink.url);
      setName(editingLink.displayName);
      setDesc(editingLink.description ?? '');
    } else {
      setUrl('');
      setName('');
      setDesc('');
    }
    setErrorKey(null);
  }, [visible, editingLink]);

  const reset = useCallback(() => {
    setUrl('');
    setName('');
    setDesc('');
    setErrorKey(null);
    setSubmitting(false);
  }, []);

  const handleClose = useCallback(() => {
    if (submitting) return;
    reset();
    onClose();
  }, [submitting, reset, onClose]);

  const submit = useCallback(async () => {
    if (!valid || submitting) return;
    setSubmitting(true);
    setErrorKey(null);
    try {
      if (editingLink) {
        const link = await container.updateDonationLink.execute({
          linkId: editingLink.id,
          categorySlug,
          url: url.trim(),
          displayName: name.trim(),
          description: desc.trim() || null,
        });
        onUpdated(link);
      } else {
        const link = await container.addDonationLink.execute({
          categorySlug,
          url: url.trim(),
          displayName: name.trim(),
          description: desc.trim() || null,
        });
        onAdded(link);
      }
      reset();
      onClose();
    } catch (err) {
      setErrorKey(isDonationLinkError(err) ? err.code : 'unknown');
    } finally {
      setSubmitting(false);
    }
  }, [
    valid,
    submitting,
    categorySlug,
    url,
    name,
    desc,
    editingLink,
    onAdded,
    onUpdated,
    reset,
    onClose,
  ]);

  return {
    url,
    setUrl,
    name,
    setName,
    desc,
    setDesc,
    valid,
    isEdit,
    submitting,
    errorKey,
    handleClose,
    submit,
  };
}
