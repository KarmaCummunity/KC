import { Platform, type FlexStyle, type TextStyle, type ViewStyle } from 'react-native';
import { isLayoutRtl, rowDirectionStart, textAlignStart } from './rtlLayout';

/**
 * Direction for content that exists only in Hebrew, whatever the UI language (FR-SETTINGS-018):
 * legal document bodies (`legal_document_versions.language` is `he` until #1733) and
 * server-authored survey copy. Translated UI strings follow the layout through `rtlLayout.ts`.
 *
 * Under an RTL layout the inline-start edge is already the visual right (native mirrors `left`).
 * Under an LTR layout (English) nothing mirrors, so the physical right edge is used.
 */
export function hebrewContentTextAlign(): 'left' | 'right' {
  return isLayoutRtl() ? textAlignStart() : 'right';
}

/** Text style for a Hebrew-only block: RTL bidi, aligned to the visual right. */
export function hebrewContentTextStyle(): TextStyle {
  return { writingDirection: 'rtl', textAlign: hebrewContentTextAlign() };
}

/** Row direction that puts the first child (a bullet) on the visual right. */
export function hebrewContentRowDirection(): FlexStyle['flexDirection'] {
  return isLayoutRtl() ? rowDirectionStart : 'row-reverse';
}

/**
 * A border on the visual right edge (a quote bar beside Hebrew text), as logical sides.
 * Only native under an RTL layout mirrors `start` to the right; RN-Web maps `start` to the left.
 */
export function hebrewContentRightBorder(width: number, color: string): ViewStyle {
  return Platform.OS !== 'web' && isLayoutRtl()
    ? { borderStartWidth: width, borderStartColor: color }
    : { borderEndWidth: width, borderEndColor: color };
}
