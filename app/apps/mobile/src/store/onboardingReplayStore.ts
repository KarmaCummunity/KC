// FR-ADMIN-035 — onboarding replay: an admin walks through the onboarding again as a preview.
//
// While `active`, the onboarding steps validate and move on exactly as for a new member but
// write nothing: no profile update, no avatar upload, no onboarding-state change. The photo the
// admin picks lives only here, as a local preview. Not persisted: a restart ends the replay.
import { create } from 'zustand';

interface OnboardingReplayState {
  /** True from "Replay onboarding" in the admin portal until the flow is finished or left. */
  readonly active: boolean;
  /** Local URI of the photo picked during the replay; never uploaded. */
  readonly avatarPreviewUri: string | null;
  /** Begins a replay from a clean slate (no photo), as a new member starts. */
  start: () => void;
  /** Ends the replay and drops the preview photo. Safe to call when no replay is running. */
  stop: () => void;
  setAvatarPreview: (uri: string | null) => void;
}

export const useOnboardingReplayStore = create<OnboardingReplayState>((set) => ({
  active: false,
  avatarPreviewUri: null,
  start: () => set({ active: true, avatarPreviewUri: null }),
  stop: () => set({ active: false, avatarPreviewUri: null }),
  setAvatarPreview: (avatarPreviewUri) => set({ avatarPreviewUri }),
}));

/** Where the onboarding ends: back in the admin portal for a replay, in the app otherwise. */
export function onboardingExitHref(replayActive: boolean): '/(admin)' | '/(tabs)' {
  return replayActive ? '/(admin)' : '/(tabs)';
}
