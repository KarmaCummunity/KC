// Mapped to spec: FR-POST-001 AC6 — the create form of the listing categories (rides, food,
// housing, time). Rides drop the title (built from the route) and put the optional car photo
// last (#1411). Same layout and controls as the items post form: header → photos → title
// → category-specific fields → description → location → publish.
import React, { useEffect, useRef, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { MAX_MEDIA_ASSETS } from '@kc/domain';
import { Text, useTheme } from '@kc/ui';
import { TextField } from '../ui/TextField';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import { pickListingImages } from '../../services/listingImageUpload';
import type { CreateDirection } from '../../lib/unifiedCreate/createCategories';
import { useListingCreateForm } from '../../hooks/useListingCreateForm';
import { CityPicker } from '../CityPicker';
import { RideCreateSection } from '../giving/RideCreateSection';
import { WorldSubcategoryPicker } from '../marketplace/WorldSubcategoryPicker';
import { AdditionalWorldsPicker } from './AdditionalWorldsPicker';
import { ListingDetailFields } from './ListingDetailFields';
import { PhotoPicker } from './PhotoPicker';
import { ListingKindChooser } from './ListingKindChooser';
import { TimeOfferKindChooser } from './TimeOfferKindChooser';

const TITLE_MAX = 80;
const SUMMARY_MAX = 500;

interface Props {
  readonly worldSlug: string;
  /** Unified create header (category picker + request/offer toggle). */
  readonly header: ReactNode;
  readonly direction: CreateDirection;
  readonly title: string;
  readonly onTitleChange: (v: string) => void;
  readonly summary: string;
  readonly onSummaryChange: (v: string) => void;
  readonly onPublished: (listingId: string) => void;
  readonly onPublishActionChange: (action: (() => void) | null, loading: boolean) => void;
}

export function ListingCreateForm({
  worldSlug,
  header,
  direction,
  title,
  onTitleChange,
  summary,
  onSummaryChange,
  onPublished,
  onPublishActionChange,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const form = useListingCreateForm({ worldSlug, direction, title, summary, onPublished });
  const publishRef = useRef(form.publish);
  publishRef.current = form.publish;

  useEffect(() => {
    onPublishActionChange(() => void publishRef.current(), form.busy);
    return () => onPublishActionChange(null, false);
  }, [form.busy, onPublishActionChange]);

  const addPhotos = async () => {
    const next = await pickListingImages(form.photos.length);
    if (next.length > 0) form.setPhotos((prev) => [...prev, ...next].slice(0, MAX_MEDIA_ASSETS));
  };

  const photoPicker = (
    <PhotoPicker
      uploads={form.photos.map((p) => ({ path: p.uri, previewUri: p.uri }))}
      isUploading={false}
      uploadingCount={0}
      required={false}
      onAdd={() => void addPhotos()}
      onRemove={(uri) => form.setPhotos((prev) => prev.filter((p) => p.uri !== uri))}
    />
  );

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}
      keyboardShouldPersistTaps="handled"
      testID="listing-create-form"
    >
      {header}
      <KindGate
        loading={form.kindsQuery.isPending}
        missing={!form.kind}
        onRetry={() => void form.kindsQuery.refetch()}
      >
        {/* Several kinds in this direction (animals, knowledge): the member says which one. */}
        {form.eventChoice.isOrgEvent ? null : (
          <ListingKindChooser
            choices={form.kindChoices}
            selectedKindId={form.kind?.kindId ?? null}
            onChoose={form.chooseKind}
            disabled={form.busy}
          />
        )}

        {/* A member of an organization picks a volunteer shift or the organization's event (G1 step 5). */}
        {form.eventChoice.available ? <TimeOfferKindChooser choice={form.eventChoice} disabled={form.busy} /> : null}

        {form.isRides ? null : photoPicker}

        {/* Rides have no title (#1411): it is built from the route. */}
        {form.isRides ? null : (
          <View style={styles.section}>
            <TextField
              testID="listing-title"
              label={`${t('post.title')} *`}
              value={title}
              onChangeText={onTitleChange}
              placeholder={t(`post.unifiedCreate.titlePlaceholder.${worldSlug}`)}
              maxLength={TITLE_MAX}
              editable={!form.busy}
            />
            <Text style={styles.charCount}>{title.length}/{TITLE_MAX}</Text>
          </View>
        )}

        {form.isRides ? (
          <RideCreateSection
            details={form.details}
            setDetails={form.setDetails}
            onOriginCity={form.setCity}
            isOffer={direction === 'give'}
            recurrence={form.recurrence}
            onRecurrenceChange={form.setRecurrence}
            leaveNow={form.leaveNow}
            onLeaveNowChange={form.setLeaveNow}
            disabled={form.busy}
          />
        ) : null}

        {form.showSubcategory ? (
          <WorldSubcategoryPicker
            worldSlug={worldSlug}
            value={form.subcategoryId}
            onChange={form.setSubcategoryId}
            disabled={form.busy}
          />
        ) : null}

        <AdditionalWorldsPicker
          primaryWorldSlug={worldSlug}
          selectedWorlds={form.additionalWorlds}
          onToggle={form.toggleAdditionalWorld}
          disabled={form.busy}
        />

        <ListingDetailFields specs={form.specs} details={form.details} onChange={form.setDetail} disabled={form.busy} />

        <View style={styles.section}>
          <TextField
            testID="listing-summary"
            label={t('post.description')}
            value={summary}
            onChangeText={onSummaryChange}
            placeholder={t('post.descPlaceholder')}
            multiline
            maxLength={SUMMARY_MAX}
            editable={!form.busy}
          />
          <Text style={styles.charCount}>{summary.length}/{SUMMARY_MAX}</Text>
        </View>

        {/* Rides keep it simple (#1411): the optional car photo sits at the bottom. */}
        {form.isRides ? photoPicker : null}

        {form.isRides ? null : (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>
              {t('post.unifiedCreate.cityLabel')} <Text style={styles.required}>*</Text>
            </Text>
            <CityPicker value={form.city} onChange={form.setCity} disabled={form.busy} />
          </View>
        )}

        {form.error ? (
          <Text style={styles.sectionHint} accessibilityRole="alert" testID="listing-error">
            {form.error}
          </Text>
        ) : null}

        <TouchableOpacity
          testID="listing-publish"
          style={[styles.publishBtn, styles.publishBtnFooter]}
          onPress={() => void form.publish()}
          disabled={!form.canPublish}
          accessibilityRole="button"
          accessibilityState={{ disabled: !form.canPublish }}
        >
          {form.busy ? (
            <ActivityIndicator color={colors.textInverse} size="small" />
          ) : (
            <Text style={styles.publishBtnText}>{t('post.publish')}</Text>
          )}
        </TouchableOpacity>
      </KindGate>
    </ScrollView>
  );
}

interface KindGateProps {
  readonly loading: boolean;
  readonly missing: boolean;
  readonly onRetry: () => void;
  readonly children: ReactNode;
}

/** Spinner while the world's kinds load; a retry message when none can be used. */
function KindGate({ loading, missing, onRetry, children }: KindGateProps) {
  const { t } = useTranslation();
  const styles = useCreatePostStyles();
  if (loading) return <ActivityIndicator testID="listing-kinds-loading" />;
  if (!missing) return <>{children}</>;
  return (
    <View style={styles.section} testID="listing-kinds-error">
      <Text style={styles.sectionHint}>{t('post.unifiedCreate.errors.loadFailed')}</Text>
      <TouchableOpacity onPress={onRetry} accessibilityRole="button">
        <Text style={styles.sectionLabel}>{t('general.retry')}</Text>
      </TouchableOpacity>
    </View>
  );
}
