// Unified Create — ONE form for every category (items post + rides / food / housing / time
// listings). Category picker, then request / offer, then the category's own fields
// (lib/unifiedCreate config). Items publish through IPostRepository (P0.4-FE).
// A root-stack screen, so it opens on top of the screen it was launched from (FR-POST-001 AC9).
// Mapped to: FR-POST-001..006 (FR-POST-001 AC6 categories + remembered choice) (incl. FR-POST-003 visibility + FR-POST-006 followers publish confirm), FR-POST-021 (D-31 partner-surface mask + collapsible exposure settings), FR-POST-007 (local draft autosave + resume), FR-POST-010 (delete) lives elsewhere.
// FR-AUTH-015 soft-gate preserved from #12 — Publish wraps publish.mutate() with requestSoftGate.
// FR-NOTIF-015 AC1: push pre-prompt fires after first post published.
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, TouchableOpacity, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { iconSize, useTheme, Text } from '@kc/ui';
import { Screen } from '../src/components/ui/Screen';
import { useAuthStore } from '../src/store/authStore';
import { useSoftGate } from '../src/components/OnboardingSoftGate';
import { usePushPermissionGate } from '../src/lib/notifications';
import { useCreatePostAddressPrefill } from '../src/hooks/useCreatePostAddressPrefill';
import { useCreatePostFormState } from '../src/hooks/useCreatePostFormState';
import { usePostDraftAutosave } from '../src/hooks/usePostDraftAutosave';
import { usePostDraftHydration } from '../src/hooks/usePostDraftHydration';
import {
  newUploadBatchId, pickPostImages, resizeAndUploadImage,
} from '../src/services/imageUpload';
import { getUserRepo } from '../src/services/userComposition';
import { useCreatePostStyles } from '../src/screens/tabs/create.styles';
import { useCreatePostPublish } from '../src/hooks/useCreatePostPublish';
import { CreatePostFormScrollContent } from '../src/components/CreatePostForm/CreatePostFormScrollContent';
import { useUnifiedCreateCategory } from '../src/hooks/useUnifiedCreateCategory';
import { useRepublishPrefill } from '../src/hooks/useRepublishPrefill';
import { WorldCreateForm } from '../src/components/CreatePostForm/WorldCreateForm';
import { CreateFormHeaderPublishAction } from '../src/components/CreatePostForm/CreateFormHeaderPublishAction';
import { useKeyboardVerticalOffset } from '../src/lib/platform/useKeyboardVerticalOffset';
import { TAB_INLINE_FORM_HEADER_HEIGHT } from '../src/lib/platform/formChromeHeights';
import { closeCreateForm } from '../src/navigation/closeCreateForm';
import { CreatePostScreenOverlays } from '../src/screens/tabs/CreatePostScreenOverlays';

export { RouteErrorBoundary as ErrorBoundary } from '../src/components/RouteErrorBoundary';

export default function CreatePostScreen() {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const router = useRouter();
  const session = useAuthStore((s) => s.session);
  const { requestSoftGate } = useSoftGate();
  const ownerId = session?.userId;
  const pushGate = usePushPermissionGate();
  const { presentPrePrompt } = pushGate;

  const {
    city,
    street,
    streetNumber,
    setCity,
    setStreet,
    setStreetNumber,
  } = useCreatePostAddressPrefill(ownerId);

  const form = useCreatePostFormState();
  const { activeCategory, direction, header, ready, selectCategory } = useUnifiedCreateCategory(ownerId, form.type, form.setType);
  // D127: `?republishFrom=` opens the source's world prefilled; the listing form publishes a new post.
  const republish = useRepublishPrefill({
    ownerId, ready, activeCategoryId: activeCategory.id, selectCategory,
    setTitle: form.setTitle, setDescription: form.setDescription,
  });

  const draftHydration = usePostDraftHydration(ownerId);

  usePostDraftAutosave({
    ownerId,
    isHydrating: draftHydration.status.phase === 'pending',
    isResumePending: draftHydration.status.phase === 'ready',
    isPostCategory: activeCategory.engine === 'post',
    type: form.type,
    title: form.title,
    description: form.description,
    category: form.category,
    condition: form.condition,
    urgency: form.urgency,
    estimatedValue: form.estimatedValue,
    locationDisplayLevel: form.locationDisplayLevel,
    visibility: form.visibility,
    hideFromCounterparty: form.hideFromCounterparty,
    uploads: form.uploads,
  });

  const userQuery = useQuery({
    queryKey: ['user-profile', ownerId],
    queryFn: () => {
      if (!ownerId) throw new Error('unreachable');
      return getUserRepo().findById(ownerId);
    },
    enabled: Boolean(ownerId),
    staleTime: 5 * 60_000, // PERF-3: profile (self) — edit-profile invalidates explicitly
  });
  const profilePrivacy = userQuery.data?.privacyMode ?? 'Public';
  const keyboardOffset = useKeyboardVerticalOffset({
    headerHeight: TAB_INLINE_FORM_HEADER_HEIGHT,
    contentBelowTopSafeArea: true,
  });

  useEffect(() => {
    if (profilePrivacy === 'Public' && form.visibility === 'FollowersOnly') {
      form.setVisibility('Public');
    }
  }, [profilePrivacy, form]);

  const [publishFollowersOpen, setPublishFollowersOpen] = useState(false);
  const [exposureSettingsOpen, setExposureSettingsOpen] = useState(false);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [batchId] = useState(() => newUploadBatchId());
  const [notify, setNotify] = useState<{ title: string; message: string } | null>(null);
  const [missingDraftImagesNotified, setMissingDraftImagesNotified] = useState(false);
  const [listingPublishAction, setListingPublishAction] = useState<(() => void) | null>(null);
  const [listingPublishLoading, setListingPublishLoading] = useState(false);
  const setListingPublishState = useCallback((action: (() => void) | null, loading: boolean) => {
    setListingPublishAction(() => action);
    setListingPublishLoading(loading);
  }, []);

  const isGive = form.type === 'Give';

  const handlePick = async () => {
    if (!ownerId) {
      setNotify({ title: t('general.errorTitle'), message: t('post.reauthRequired') });
      return;
    }
    const picked = await pickPostImages(form.uploads.length + uploadingCount);
    if (picked.length === 0) return;

    setUploadingCount((n) => n + picked.length);
    try {
      const startOrdinal = form.uploads.length;
      const r = await Promise.allSettled(
        picked.map((p, i) => resizeAndUploadImage(p, ownerId, batchId, startOrdinal + i)),
      );
      const ok = r.flatMap((x) => (x.status === 'fulfilled' ? [x.value] : []));
      if (ok.length > 0) form.setUploads((prev) => [...prev, ...ok]);
      if (ok.length < r.length) {
        const msg =
          ok.length === 0 ? t('post.uploadRetry') : t('post.uploadPartial', { ok: ok.length, total: r.length });
        setNotify({ title: t('post.uploadFailedTitle'), message: msg });
      }
    } finally {
      setUploadingCount((n) => Math.max(0, n - picked.length));
    }
  };

  const handleRemove = (path: string) =>
    form.setUploads((prev) => prev.filter((u) => u.path !== path));

  const { tryPublish, runPublishAfterGate, isPublishing, addressInlineMessage } =
    useCreatePostPublish({
    ownerId,
    type: form.type,
    title: form.title,
    description: form.description,
    category: form.category,
    city,
    street,
    streetNumber,
    locationDisplayLevel: form.locationDisplayLevel,
    condition: form.condition,
    isGive,
    urgency: form.urgency,
    estimatedValue: form.estimatedValue,
    uploads: form.uploads,
    hideFromCounterparty: form.hideFromCounterparty,
    visibilityRef: form.visibilityRef,
    setPublishFollowersOpen,
    requestSoftGate,
    uploadingCount,
    presentPrePrompt,
  });

  const handleDraftContinue = () => {
    const hydrated = draftHydration.continueWithDraft();
    if (!hydrated) return;
    selectCategory('items');
    form.applyDraft(hydrated);
    if (hydrated.missingCount > 0 && !missingDraftImagesNotified) {
      setMissingDraftImagesNotified(true);
      setNotify({ title: t('post.uploadFailedTitle'), message: t('post.draftMissingImage') });
    }
  };

  return (
    <Screen blobs="off" testID="create-post-screen">
      <View style={styles.header}>
        <TouchableOpacity onPress={() => closeCreateForm(router)} style={styles.headerClose}>
          <Ionicons name="close" size={iconSize['2xl']} color={colors.textPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('tabs.newPost')}</Text>
        <CreateFormHeaderPublishAction
          onPress={activeCategory.engine === 'post' ? tryPublish : () => listingPublishAction?.()}
          loading={activeCategory.engine === 'post' ? isPublishing : listingPublishLoading}
          disabled={activeCategory.engine !== 'post' && listingPublishAction === null}
        />
      </View>

      {!ready || republish.loading ? (
        <ActivityIndicator style={styles.scroll} testID="create-preferences-loading" />
      ) : activeCategory.engine !== 'post' ? (
        <KeyboardAvoidingView
          style={styles.scroll}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={keyboardOffset}
        >
          <WorldCreateForm
            category={activeCategory}
            header={header}
            direction={direction}
            title={form.title}
            onTitleChange={form.setTitle}
            summary={form.description}
            onSummaryChange={form.setDescription}
            onPublishActionChange={setListingPublishState}
            republishFromListingId={republish.republishFromListingId}
          />
        </KeyboardAvoidingView>
      ) : (
      <KeyboardAvoidingView
        style={styles.scroll}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={keyboardOffset}
      >
        <CreatePostFormScrollContent
        header={header}
        title={form.title}
        onTitleChange={form.setTitle}
        city={city}
        onCityChange={setCity}
        street={street}
        onStreetChange={setStreet}
        streetNumber={streetNumber}
        onStreetNumberChange={setStreetNumber}
        addressInlineError={addressInlineMessage}
        category={form.category}
        onCategoryChange={form.setCategory}
        isGive={isGive}
        condition={form.condition}
        onConditionChange={form.setCondition}
        description={form.description}
        onDescriptionChange={form.setDescription}
        exposureSettingsOpen={exposureSettingsOpen}
        onToggleExposureSettings={() => setExposureSettingsOpen((o) => !o)}
        locationDisplayLevel={form.locationDisplayLevel}
        onLocationDisplayLevelChange={form.setLocationDisplayLevel}
        isPublishing={isPublishing}
        urgency={form.urgency}
        onUrgencyChange={form.setUrgency}
        estimatedValue={form.estimatedValue}
        onEstimatedValueChange={form.setEstimatedValue}
        visibility={form.visibility}
        onVisibilityChange={form.setVisibility}
        profilePrivacy={profilePrivacy}
        hideFromCounterparty={form.hideFromCounterparty}
        onHideFromCounterpartyChange={form.setHideFromCounterparty}
        uploads={form.uploads}
        uploadingCount={uploadingCount}
        onAddPhotos={handlePick}
        onRemovePhoto={handleRemove}
        />
      </KeyboardAvoidingView>
      )}

      <CreatePostScreenOverlays
        draftResumeVisible={draftHydration.status.phase === 'ready'}
        onDraftContinue={handleDraftContinue}
        onDraftStartFresh={draftHydration.startFresh}
        pushGate={pushGate}
        ownerId={ownerId}
        notify={notify}
        onNotifyDismiss={() => setNotify(null)}
        publishFollowersOpen={publishFollowersOpen}
        followersCount={userQuery.data?.followersCount ?? 0}
        setPublishFollowersOpen={setPublishFollowersOpen}
        setVisibility={form.setVisibility}
        visibilityRef={form.visibilityRef}
        runPublishAfterGate={runPublishAfterGate}
      />
    </Screen>
  );
}
