import type { TextStyle, ViewStyle } from 'react-native';
import { layoutWritingDirectionStyle } from './rtlLayout';

/**
 * View-level RTL on web comes from `document.documentElement.dir` (see `_layout.tsx`).
 * RN-Web rejects the CSS `direction` property on `View` styles — it logs once per
 * affected node ("Did you mean writingDirection?"), which floods LogBox when spread
 * widely. Keep this empty; use `webTextRtl`, `rowDirectionStart`, and `rtlTextAlignStart`.
 *
 * iOS/Android: **omit** — `I18nManager.forceRTL(true)` already mirrors the tree.
 */
export const webViewRtl: ViewStyle = {};

/**
 * Web-only text `writingDirection` for the active locale (FR-SETTINGS-018):
 * RTL (Hebrew) → `rtl`; LTR (English) → `ltr`. Resolved once at module load; the
 * app reloads on a language switch. Native omits it (I18nManager handles bidi).
 * The logic is `layoutWritingDirectionStyle()` in `rtlLayout.ts` (issue #1289).
 */
export const webTextRtl: TextStyle = layoutWritingDirectionStyle();
