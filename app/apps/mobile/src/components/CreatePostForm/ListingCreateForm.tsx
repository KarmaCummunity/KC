// Mapped to spec: FR-POST-001 AC6 — the create form of the listing categories (rides, food,
// housing, time). Rides drop the title (built from the route) and put the optional car photo
// last (#1411). Same layout and controls as the items post form: header → photos → title
// → category-specific fields → description → location → publish.
import React, { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { ActivityIndicator, ScrollView, TouchableOpacity, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { offerRequiresPhoto } from '@kc/domain';
import { spacing, Text, useTheme } from '@kc/ui';
import { TextField } from '../ui/TextField';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import type { CreateDirection } from '../../lib/unifiedCreate/createCategories';
import { useListingCreateForm } from '../../hooks/useListingCreateForm';
import { useScrollToListingProblem } from '../../hooks/useScrollToListingProblem';
import { visibleDetailSpecs } from '../../lib/unifiedCreate/listingFieldSpecs';
import { inlineProblemField, renderedListingFields } from '../../lib/unifiedCreate/listingFormProblem';
import { CityPicker } from '../CityPicker';
import { RideCreateSection } from '../giving/RideCreateSection';
import { WorldSubcategoryPicker } from '../marketplace/WorldSubcategoryPicker';
import { AdditionalWorldsPicker } from './AdditionalWorldsPicker';
import { ListingDetailFields } from './ListingDetailFields';
import { ListingFieldFrame, ListingFieldProblemContext } from './ListingFieldFrame';
import { ListingFormPhotoPicker } from './ListingFormPhotoPicker';
import { ListingKindChooser } from './ListingKindChooser';
import { KindGate } from './ListingKindGate';
import { TimeOfferKindChooser } from './TimeOfferKindChooser';
import { OrgEventMembershipHint } from './OrgEventMembershipHint';
import { formKeyboardAccessoryProps, useFormFieldFocus } from '../../hooks/useFormFieldFocus';
import { KeyboardFormAccessory } from '../ui/KeyboardFormAccessory';

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
  readonly editListingId?: string | null;
  readonly onSaved?: () => void;
  /** Republish (D127): start from this listing minus its dates and publish a new listing. */
  readonly republishFromListingId?: string | null;
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
  editListingId = null,
  onSaved,
  republishFromListingId = null,
}: Props) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const tabBarPad = useShellTabBarScrollInset();
  const form = useListingCreateForm({
    worldSlug,
    direction,
    title,
    summary,
    onPublished,
    editListingId,
    onSaved,
    republishFromListingId,
  });
  const publishRef = useRef(form.publish);
  publishRef.current = form.publish;
  const rendered = renderedListingFields({
    isRides: form.isRides,
    isOrgEvent: form.eventChoice.isOrgEvent,
    detailKeys: visibleDetailSpecs(form.specs, form.details).map((s) => s.key),
    showSubcategory: form.showSubcategory,
  });
  const invalidField = inlineProblemField(form.error, rendered);
  const { scrollRef, contentRef, register, onScroll } = useScrollToListingProblem(form.error, invalidField);
  const message = form.error?.message ?? null;
  const problemContext = useMemo(() => ({ invalidField, message, register }), [invalidField, message, register]);
  const titleProblem = invalidField === 'title' ? message : null;
  const textFieldCount = form.isRides ? 1 : 2;
  const fieldFocus = useFormFieldFocus(textFieldCount);
  const titleField = useMemo(
    () => (form.isRides ? null : fieldFocus.bindField(0)),
    [fieldFocus, form.isRides],
  );
  const summaryField = fieldFocus.bindField(form.isRides ? 0 : 1);

  useEffect(() => {
    onPublishActionChange(() => void publishRef.current(), form.busy);
    return () => onPublishActionChange(null, false);
  }, [form.busy, onPublishActionChange]);

  // An offer in a photo world needs one photo (D132); an edit keeps its photos.
  const photoPicker = (
    <ListingFieldFrame field="photos" testID="listing-photos-field">
      <ListingFormPhotoPicker
        photos={form.photos}
        setPhotos={form.setPhotos}
        carriedMediaPaths={form.carriedMediaPaths}
        onRemoveCarried={form.removeCarriedMedia}
        required={!editListingId && offerRequiresPhoto(worldSlug, direction)}
      />
    </ListingFieldFrame>
  );

  if (form.editLoading) {
    return (
      <View style={styles.scroll}>
        <ActivityIndicator style={{ marginTop: spacing['3xl'] }} testID="listing-edit-loading" />
      </View>
    );
  }

  return (
    <>
      <KeyboardFormAccessory {...formKeyboardAccessoryProps(fieldFocus)} />
    <ScrollView
      ref={scrollRef}
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      scrollEventThrottle={16}
      testID="listing-create-form"
    >
      <View ref={contentRef} collapsable={false}>
      {header}
      <ListingFieldProblemContext.Provider value={problemContext}>
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

          {/* A member of an organization picks a volunteer shift or the organization's event (G1 step 5);
              anyone else is told how to become one (FR-ORG-002). */}
          {form.eventChoice.available ? <TimeOfferKindChooser choice={form.eventChoice} disabled={form.busy} /> : null}
          {form.eventChoice.suggestMembership ? <OrgEventMembershipHint /> : null}

          {form.isRides ? null : photoPicker}

          {/* Rides have no title (#1411): it is built from the route. */}
          {form.isRides ? null : (
            <ListingFieldFrame field="title" outlined={false} style={styles.section}>
              <TextField
                ref={titleField?.ref}
                testID="listing-title"
                label={`${t('post.title')} *`}
                value={title}
                onChangeText={onTitleChange}
                placeholder={t(`post.unifiedCreate.titlePlaceholder.${worldSlug}`, { defaultValue: t('post.titlePlaceholder') })}
                maxLength={TITLE_MAX}
                editable={!form.busy}
                errorText={titleProblem ?? undefined}
                onFocus={titleField?.onFocus}
                inputAccessoryViewID={titleField?.inputAccessoryViewID}
                returnKeyType={titleField?.returnKeyType}
                blurOnSubmit={titleField?.blurOnSubmit}
                onSubmitEditing={titleField?.onSubmitEditing}
              />
              <Text style={styles.charCount}>{title.length}/{TITLE_MAX}</Text>
            </ListingFieldFrame>
          )}

          {form.isRides ? (
            <RideCreateSection
              details={form.details}
              setDetails={form.setDetails}
              onOriginCity={form.setCity}
              isOffer={direction === 'give'}
              recurrence={form.isEdit ? null : form.recurrence}
              onRecurrenceChange={form.isEdit ? () => {} : form.setRecurrence}
              leaveNow={form.isEdit ? false : form.leaveNow}
              onLeaveNowChange={form.isEdit ? () => {} : form.setLeaveNow}
              onOriginFromHereChange={form.setOriginFromHere}
              houseNumbers={form.houseNumbers}
              onHouseNumbersChange={form.setHouseNumbers}
              disabled={form.busy}
            />
          ) : null}

          {form.showSubcategory ? (
            <ListingFieldFrame field="subcategory" testID="listing-subcategory-field">
              <WorldSubcategoryPicker
                worldSlug={worldSlug}
                value={form.subcategoryId}
                onChange={form.setSubcategoryId}
                disabled={form.busy}
              />
            </ListingFieldFrame>
          ) : null}

          <AdditionalWorldsPicker
            primaryWorldSlug={worldSlug}
            selectedWorlds={form.additionalWorlds}
            onToggle={form.toggleAdditionalWorld}
            disabled={form.busy}
          />

          <ListingDetailFields
            specs={form.specs}
            details={form.details}
            onChange={form.setDetail}
            disabled={form.busy}
          />

          <View style={styles.section}>
            <TextField
              ref={summaryField.ref}
              testID="listing-summary"
              label={t('post.description')}
              value={summary}
              onChangeText={onSummaryChange}
              placeholder={t(`post.unifiedCreate.descPlaceholder.${worldSlug}`, {
                defaultValue: t('post.unifiedCreate.descPlaceholder.default'),
              })}
              multiline
              maxLength={SUMMARY_MAX}
              editable={!form.busy}
              onFocus={summaryField.onFocus}
              inputAccessoryViewID={summaryField.inputAccessoryViewID}
              returnKeyType={summaryField.returnKeyType}
              blurOnSubmit={summaryField.blurOnSubmit}
              onSubmitEditing={summaryField.onSubmitEditing}
            />
            <Text style={styles.charCount}>{summary.length}/{SUMMARY_MAX}</Text>
          </View>

          {/* Rides keep it simple (#1411): the optional car photo sits at the bottom. */}
          {form.isRides ? photoPicker : null}

          {form.isRides ? null : (
            <ListingFieldFrame
              field="city"
              style={styles.section}
              label={
                <Text style={styles.sectionLabel}>
                  {t('post.unifiedCreate.cityLabel')} <Text style={styles.required}>*</Text>
                </Text>
              }
            >
              <CityPicker value={form.city} onChange={form.setCity} disabled={form.busy} />
            </ListingFieldFrame>
          )}

          {/* Only problems no section owns (server errors) sit above Publish. */}
          {form.error && !invalidField ? (
            <Text style={styles.sectionHint} accessibilityRole="alert" testID="listing-error">
              {form.error.message}
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
      </ListingFieldProblemContext.Provider>
      </View>
    </ScrollView>
    </>
  );
}
