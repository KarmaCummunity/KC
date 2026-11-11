import { resolveFeatureFlag, type FeatureFlagKey } from '../config/featureFlags';
import { useAppFlags } from './useAppFlags';

/** Remote flag value, falling back to the compiled default while loading / offline / signed out. */
export function useFeatureFlag(key: FeatureFlagKey): boolean {
  return resolveFeatureFlag(key, useAppFlags());
}
