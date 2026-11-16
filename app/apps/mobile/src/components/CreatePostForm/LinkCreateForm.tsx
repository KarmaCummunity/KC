// Mapped to spec: FR-POST-001 AC6 / D100 — the create form of a giving world that has no feed
// yet (money, knowledge, medical, animals, democracy, employment, challenges): "add a link"
// to the world's community links list (FR-DONATE-008). Same fields and approval rule (D9) as
// the add-link sheet; the world's portal screen lists the link once a reviewer approves it.
import React, { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { DonationCategorySlug, DonationLink } from '@kc/domain';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { DonationLinkFields } from '../DonationLinkFields';
import { PrimaryButton } from '../ui/Buttons';
import { FormScrollView } from '../ui/FormScrollView';
import { FormSection } from '../ui/FormSection';
import { useAddOrEditDonationLinkModal } from '../useAddOrEditDonationLinkModal';

interface Props {
  readonly categorySlug: DonationCategorySlug;
  /** Unified create header (category picker; the request / offer toggle is hidden here). */
  readonly header: ReactNode;
  readonly onAdded: (link: DonationLink) => void;
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
}

const NOOP = () => undefined;

export function LinkCreateForm({ categorySlug, header, onAdded, onPublishActionChange }: Props) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  const tabBarPad = useShellTabBarScrollInset();
  // Always "visible": the form is the screen itself, so the hook's reset-on-open runs once.
  const form = useAddOrEditDonationLinkModal({
    visible: true,
    categorySlug,
    editingLink: null,
    onClose: NOOP,
    onAdded,
    onUpdated: NOOP,
  });
  const submitRef = useRef(form.submit);
  submitRef.current = form.submit;

  // The header's publish action submits this form too.
  useEffect(() => {
    onPublishActionChange(() => void submitRef.current(), form.submitting);
    return () => onPublishActionChange(null, false);
  }, [form.submitting, onPublishActionChange]);

  return (
    <FormScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}
      jumpToProblemSignal={form.failedSubmitCount}
      testID="link-create-form"
    >
      {header}
      <FormSection hint={t('post.unifiedCreate.linkWorldIntro')}>{null}</FormSection>
      <DonationLinkFields {...form} />
      <PrimaryButton
        testID="link-publish"
        label={form.submitting ? t('donations.addLinkModal.submitting') : t('donations.addLinkModal.submit')}
        size="md"
        fullWidth
        onPress={() => void form.submit()}
        disabled={form.submitting}
      />
    </FormScrollView>
  );
}
