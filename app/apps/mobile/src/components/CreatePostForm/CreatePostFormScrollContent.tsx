import React, { useMemo, type ReactNode } from 'react';
import {
  ScrollView,
  TouchableOpacity,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTheme, Text, TextInput } from '@kc/ui';
import { formStreetNumberInputProps } from '../../lib/platform/formTextInputHints';
import { ALL_CATEGORIES, ITEM_CONDITIONS } from '@kc/domain';
import type { Category, ItemCondition, LocationDisplayLevel, PostVisibility } from '@kc/domain';
import { CityPicker } from '../CityPicker';
import { StreetPicker } from '../StreetPicker';
import { CreatePostExposureSection } from './CreatePostExposureSection';
import { EstimatedValueSlider } from './EstimatedValueSlider';
import { PhotoPicker } from './PhotoPicker';
import { Chip } from '../ui/Chip';
import { TextField } from '../ui/TextField';
import { rtlTextAlignStart } from '../../lib/rtlTextAlignStart';
import type { UploadedAsset } from '../../services/imageUpload';
import { useCreatePostStyles } from '../../screens/tabs/create.styles';
import { useShellTabBarScrollInset } from '../../navigation/useShellTabBarVisibility';
import type { CreatePostCitySelection } from '../../hooks/useCreatePostPublish';
import { useFormFieldFocus } from '../../hooks/useFormFieldFocus';
import { KeyboardFormAccessory } from '../ui/KeyboardFormAccessory';

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
  readonly addressInlineError: string | null;
  readonly category: Category;
  readonly onCategoryChange: (next: Category) => void;
  readonly isGive: boolean;
  readonly condition: ItemCondition;
  readonly onConditionChange: (next: ItemCondition) => void;
  readonly description: string;
  readonly onDescriptionChange: (next: string) => void;
  readonly exposureSettingsOpen: boolean;
  readonly onToggleExposureSettings: () => void;
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
  addressInlineError,
  category,
  onCategoryChange,
  isGive,
  condition,
  onConditionChange,
  description,
  onDescriptionChange,
  exposureSettingsOpen,
  onToggleExposureSettings,
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
  const textFieldCount = isGive ? 3 : 4;
  const fieldFocus = useFormFieldFocus(textFieldCount);
  const titleField = fieldFocus.bindField(0);
  const streetNumberField = fieldFocus.bindField(1);
  const descriptionField = fieldFocus.bindField(2);
  const urgencyField = useMemo(
    () => (isGive ? null : fieldFocus.bindField(3)),
    [fieldFocus, isGive],
  );

  return (
    <>
      <KeyboardFormAccessory
        canGoPrev={fieldFocus.canGoPrev}
        canGoNext={fieldFocus.canGoNext}
        onPrev={fieldFocus.focusPrev}
        onNext={fieldFocus.focusNext}
        onDone={fieldFocus.dismiss}
      />
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: tabBarPad }]}
    >
      {header}

      <PhotoPicker
        uploads={uploads}
        isUploading={uploadingCount > 0}
        uploadingCount={uploadingCount}
        required={isGive}
        onAdd={onAddPhotos}
        onRemove={onRemovePhoto}
      />

      <View style={styles.section}>
        <TextField
          ref={titleField.ref}
          testID="create-post-title"
          label={`${t('post.title')} *`}
          value={title}
          onChangeText={onTitleChange}
          placeholder={t('post.titlePlaceholder')}
          maxLength={80}
          onFocus={titleField.onFocus}
          inputAccessoryViewID={titleField.inputAccessoryViewID}
          returnKeyType={titleField.returnKeyType}
          blurOnSubmit={titleField.blurOnSubmit}
          onSubmitEditing={titleField.onSubmitEditing}
        />
        <Text style={styles.charCount}>{title.length}/80</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>
          {t('post.address')} <Text style={styles.required}>*</Text>
        </Text>
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
            ref={streetNumberField.ref}
            style={[styles.input, styles.streetInputHouse, !city ? { opacity: 0.5 } : null]}
            value={streetNumber}
            onChangeText={onStreetNumberChange}
            placeholder={t('post.streetNumberShort')}
            placeholderTextColor={colors.textDisabled}
            textAlign={rtlTextAlignStart}
            editable={!isPublishing && !!city}
            {...formStreetNumberInputProps}
            onFocus={streetNumberField.onFocus}
            inputAccessoryViewID={streetNumberField.inputAccessoryViewID}
            returnKeyType={streetNumberField.returnKeyType}
            blurOnSubmit={streetNumberField.blurOnSubmit}
            onSubmitEditing={streetNumberField.onSubmitEditing}
          />
        </View>
        {addressInlineError ? (
          <Text style={styles.sectionHint} accessibilityRole="alert">
            {addressInlineError}
          </Text>
        ) : null}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionLabel}>{t('post.categoryLabel')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips}>
          {ALL_CATEGORIES.map((cat) => (
            <Chip
              key={cat}
              label={t(`post.category.${cat}`)}
              selected={category === cat}
              onPress={() => onCategoryChange(cat)}
              style={styles.chipGap}
            />
          ))}
        </ScrollView>
      </View>

      {isGive && (
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t('post.conditionLabel')}</Text>
          <View style={styles.conditionRow}>
            {ITEM_CONDITIONS.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.conditionBtn, condition === c && styles.conditionBtnActive]}
                onPress={() => onConditionChange(c)}
              >
                <Text style={[styles.conditionText, condition === c && styles.conditionTextActive]}>
                  {t(`post.condition.${c}`)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <EstimatedValueSlider value={estimatedValue} onChange={onEstimatedValueChange} />
        </View>
      )}

      <View style={styles.section}>
        <TextField
          ref={descriptionField.ref}
          label={t('post.description')}
          value={description}
          onChangeText={onDescriptionChange}
          placeholder={t('post.descPlaceholder')}
          multiline
          maxLength={500}
          onFocus={descriptionField.onFocus}
          inputAccessoryViewID={descriptionField.inputAccessoryViewID}
          returnKeyType={descriptionField.returnKeyType}
          blurOnSubmit={descriptionField.blurOnSubmit}
          onSubmitEditing={descriptionField.onSubmitEditing}
        />
        <Text style={styles.charCount}>{description.length}/500</Text>
      </View>

      {!isGive && (
        <View style={styles.section}>
          <TextField
            ref={urgencyField?.ref}
            label={t('post.urgency')}
            value={urgency}
            onChangeText={onUrgencyChange}
            placeholder={t('post.urgencyPlaceholder')}
            maxLength={100}
            onFocus={urgencyField?.onFocus}
            inputAccessoryViewID={urgencyField?.inputAccessoryViewID}
            returnKeyType={urgencyField?.returnKeyType}
            blurOnSubmit={urgencyField?.blurOnSubmit}
            onSubmitEditing={urgencyField?.onSubmitEditing}
          />
        </View>
      )}

      <CreatePostExposureSection
        open={exposureSettingsOpen}
        onToggleOpen={onToggleExposureSettings}
        locationDisplayLevel={locationDisplayLevel}
        onLocationDisplayLevelChange={onLocationDisplayLevelChange}
        isPublishing={isPublishing}
        visibility={visibility}
        onVisibilityChange={onVisibilityChange}
        profilePrivacy={profilePrivacy}
        hideFromCounterparty={hideFromCounterparty}
        onHideFromCounterpartyChange={onHideFromCounterpartyChange}
      />

    </ScrollView>
    </>
  );
}
