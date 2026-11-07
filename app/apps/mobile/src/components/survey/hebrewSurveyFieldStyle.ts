import { Platform, type TextStyle } from 'react-native';
import { hebrewContentTextStyle } from '../../lib/hebrewContentDirection';

/**
 * Hebrew survey TextInput alignment — physical `right` on every platform so
 * placeholders and typed text hug the visual right edge.
 */
export const SURVEY_TEXT_ALIGN = 'right' as const;

/**
 * RTL TextInput style for a server-authored Hebrew survey field (native + RN-web), whatever the
 * UI language. Native inputs do not mirror `left` / `right`, so the physical edge is used.
 */
export function hebrewSurveyFieldTextStyle(): TextStyle {
  return {
    ...hebrewContentTextStyle(),
    textAlign: SURVEY_TEXT_ALIGN,
    ...(Platform.OS !== 'web' ? { textAlignVertical: 'top' as const } : {}),
  };
}
