import { type TextStyle } from 'react-native';

import { rowDirectionStart, rtlTextAlignStart } from '../../lib/rtlLayout';
import { webViewRtl, webTextRtl } from '../../lib/webRtlStyle';

export const aboutWebViewRtl = webViewRtl;
export const aboutWebTextRtl = webTextRtl;

/** Hebrew text alignment — correct on iOS forceRTL and web `dir=rtl`. */
export const aboutRtlText: TextStyle = {
  textAlign: rtlTextAlignStart,
  ...webTextRtl,
};

/** `flexDirection` for reading-start rows; matches `rowDirectionStart`. */
export const aboutRtlRow = rowDirectionStart;
