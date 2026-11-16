import React, { useRef, type ReactNode } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, Text, TextInput, type TextInput as KitTextInput } from '@kc/ui';
import { formStreetNumberInputProps } from '../../lib/platform/formTextInputHints';
import { ALL_CATEGORIES, ITEM_CONDITIONS } from '@kc/domain';
import type { Category, ItemCondition, LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { CityPicker } from '../CityPicker';
import { StreetPicker } from '../StreetPicker';
import { ExposureSettingsSection } from '../post/ExposureSettingsSection';
import { EstimatedValueSlider } from './EstimatedValueSlider';
import { PhotoPicker } from './PhotoPicker';
import { TextField } from '../ui/TextField';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import type { UploadedAsset } from '../../services/imageUpload';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import type { CreatePostCitySelection } from '../../hooks/useCreatePostPublish';
import { FormScrollView } from '../ui/FormScrollView';
import { useFormScopeField } from '../ui/useFormScopeField';
import { FormSection } from '../ui/FormSection';
import { FilterChipRow } from '../filterKit/FilterChipRow';

export interface CreatePostFormScrollContentProps {
  /** Unified create header (category picker + give/request toggle). */
  readonly header: ReactNode;
  readonly title: string;
  readonly onTitleChange: (next: string) => void;
  readonly city: CreatePostCitySelection;
  readonly onCityChange: (selection: { id: string; name: string }) => void;
  readonly street: string;
  readonly onStreetChange: (next: string) => void;
  readonly streetNumber: string;
  readonly onStreetNumberChange: (next: string) => void;
  /** Shown after Publish is tapped while address fields are incomplete (FR-POST-002 AC4). */
  /** Inline problem under the title field after a rejected Publish (null when fine). */
  readonly titleInlineError: string | null;
  /** Inline problem under the photo picker after a rejected Publish (null when fine). */
  readonly photoInlineError: string | null;
  /** Bumped on every rejected Publish so the form jumps to the first problem again. */
  readonly failedSubmitCount: number;
  readonly addressInlineError: string | null;
  readonly category: Category;
  readonly onCategoryChange: (next: Category) => void;
  readonly isGive: boolean;
  readonly condition: ItemCondition;
  readonly onConditionChange: (next: ItemCondition) => void;
  readonly description: string;
  readonly onDescriptionChange: (next: string) => void;
  readonly locationDisplayLevel: LocationDisplayLevel;
  readonly onLocationDisplayLevelChange: (next: LocationDisplayLevel) => void;
  readonly isPublishing: boolean;
  readonly urgency: string;
  readonly onUrgencyChange: (next: string) => void;
  readonly estimatedValue: number;
  readonly onEstimatedValueChange: (next: number) => void;
  readonly visibility: PostVisibility;
  readonly onVisibilityChange: (next: PostVisibility) => void;
  readonly profilePrivacy: 'Public' | 'Private';
  readonly hideFromCounterparty: boolean;
  readonly onHideFromCounterpartyChange: (next: boolean) => void;
  readonly uploads: UploadedAsset[];
  readonly uploadingCount: number;
  readonly onAddPhotos: () => void;
  readonly onRemovePhoto: (path: string) => void;
}

export function CreatePostFormScrollContent({
  header,
  title,
  onTitleChange,
  city,
  onCityChange,
  street,
  onStreetChange,
  streetNumber,
  onStreetNumberChange,
  titleInlineError,
  photoInlineError,
  failedSubmitCount,
  addressInlineError,
  category,
  onCategoryChange,
  isGive,
  condition,
  onConditionChange,
  description,
  onDescriptionChange,
  locationDisplayLevel,
  onLocationDisplayLevelChange,
  isPublishing,
  urgency,
  onUrgencyChange,
  estimatedValue,
  onEstimatedValueChange,
  visibility,
  onVisibilityChange,
  profilePrivacy,
  hideFromCounterparty,
  onHideFromCounterpartyChange,
  uploads,
  uploadingCount,
  onAddPhotos,
  onRemovePhoto,
}: CreatePostFormScrollContentProps) {
  const { t } = useTranslation();
  const { colors } = useTheme();
  const styles = useCreatePostStyles();
  const tabBarPad = useShellTabBarScrollInset();
  // The house-number box is a bare TextInput (no label), so it joins the form scope by hand.
  const streetNumberRef = useRef<KitTextInput>(null);
  const streetNumberScope = useFormScopeField({
    inputRef: streetNumberRef,
    viewRef: streetNumberRef,
    editable: !isPublishing && !!city,
    hasError: Boolean(addressInlineError),
  });

  return (
    <FormScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}
      jumpToProblemSignal={failedSubmitCount}
    >
      {header}

      <FormSection error={photoInlineError} testID="create-post-photos">
        <PhotoPicker
          uploads={uploads}
          isUploading={uploadingCount > 0}
          uploadingCount={uploadingCount}
          required={isGive}
          onAdd={onAddPhotos}
          onRemove={onRemovePhoto}
        />
      </FormSection>

      <FormSection outlined={false}>
        <TextField
          testID="create-post-title"
          label={`${t('post.title')} *`}
          errorText={titleInlineError ?? undefined}
          value={title}
          onChangeText={onTitleChange}
          placeholder={t('post.titlePlaceholder')}
          maxLength={80}
        />
        <Text style={styles.charCount}>{title.length}/80</Text>
      </FormSection>

      <FormSection label={t('post.address')} required error={addressInlineError} outlined={false}>
        <CityPicker value={city} onChange={onCityChange} disabled={isPublishing} />
        <View style={styles.streetRow}>
          <View style={styles.streetInputStreet}>
            <StreetPicker
              cityId={city?.id ?? null}
              value={street ? { id: '', name: street } : null}
              onChange={(sel) => onStreetChange(sel.name)}
              disabled={isPublishing}
            />
          </View>
          <TextInput // brand-guard-allow: compact house-number box inline beside the street picker; TextField stacks a label
            ref={streetNumberRef}
            style={[styles.input, styles.streetInputHouse, !city ? { opacity: 0.5 } : null]}
            value={streetNumber}
            onChangeText={onStreetNumberChange}
            placeholder={t('post.streetNumberShort')}
            placeholderTextColor={colors.textDisabled}
            textAlign={rtlTextAlignStart}
            editable={!isPublishing && !!city}
            {...formStreetNumberInputProps}
            {...streetNumberScope.inputProps}
            onFocus={streetNumberScope.onFocus}
            onBlur={streetNumberScope.onBlur}
            onSubmitEditing={streetNumberScope.onSubmitEditing}
          />
        </View>
      </FormSection>

      <FormSection label={t('post.categoryLabel')}>
        <FilterChipRow<Category>
          testID="create-post-category"
          chipSize="md"
          options={ALL_CATEGORIES.map((cat) => ({ value: cat, label: t(`post.category.${cat}`) }))}
          value={category}
          onChange={(next) => next && onCategoryChange(next)}
        />
      </FormSection>

      {isGive && (
        <FormSection label={t('post.conditionLabel')}>
          <FilterChipRow<ItemCondition>
            testID="create-post-condition"
            chipSize="md"
            options={ITEM_CONDITIONS.map((c) => ({ value: c, label: t(`post.condition.${c}`) }))}
            value={condition}
            onChange={(next) => next && onConditionChange(next)}
          />
          <EstimatedValueSlider value={estimatedValue} onChange={onEstimatedValueChange} />
        </FormSection>
      )}

      <FormSection outlined={false}>
        <TextField
          label={t('post.description')}
          value={description}
          onChangeText={onDescriptionChange}
          placeholder={t('post.descPlaceholder')}
          multiline
          maxLength={500}
        />
        <Text style={styles.charCount}>{description.length}/500</Text>
      </FormSection>

      {!isGive && (
        <FormSection outlined={false}>
          <TextField
            label={t('post.urgency')}
            value={urgency}
            onChangeText={onUrgencyChange}
            placeholder={t('post.urgencyPlaceholder')}
            maxLength={100}
          />
        </FormSection>
      )}

      <ExposureSettingsSection
        locationDisplayLevel={locationDisplayLevel}
        onLocationDisplayLevelChange={onLocationDisplayLevelChange}
        disabled={isPublishing}
        visibility={visibility}
        onVisibilityChange={onVisibilityChange}
        profilePrivacy={profilePrivacy}
        hideFromCounterparty={hideFromCounterparty}
        onHideFromCounterpartyChange={onHideFromCounterpartyChange}
      />

    </FormScrollView>
  );
}
