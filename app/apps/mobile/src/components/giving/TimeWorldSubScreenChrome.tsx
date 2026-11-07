import React from 'react';
import { WorldSubScreenChrome } from './useWorldHeader';

/** FR-FEED-020 AC2 — TopBar world menu on time-world sub-screens. */
export function TimeWorldSubScreenChrome({
  activeScreenTestId,
  screenTitleKey,
}: Readonly<{ activeScreenTestId: string; screenTitleKey?: string }>) {
  return (
    <WorldSubScreenChrome
      worldSlug="time"
      activeScreenTestId={activeScreenTestId}
      screenTitleKey={screenTitleKey}
    />
  );
}
