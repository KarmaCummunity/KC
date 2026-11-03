// Kit `Chip` tag looks for the admin task status, priority and category tags
// (spec 17 §4.1 / §4.3, TD-243). Every value within a group has its own look
// (design-lead call, D99): status and priority use a
// different tone per value; category has eight values for seven tones, so
// finance and operations share `neutral` and every category also carries its
// own leading icon, which tells those two apart without relying on colour.
import type { Ionicons } from '@expo/vector-icons';
import type { AdminTaskCategory, AdminTaskPriority, AdminTaskStatus } from '@kc/domain';
import type { ChipTone } from '../../ui/Chip';

export const TASK_STATUS_TONE: Readonly<Record<AdminTaskStatus, ChipTone>> = {
  open: 'neutral',
  in_progress: 'info',
  blocked: 'warning',
  done: 'success',
  archived: 'muted',
};

export const TASK_PRIORITY_TONE: Readonly<Record<AdminTaskPriority, ChipTone>> = {
  low: 'muted',
  medium: 'neutral',
  high: 'warning',
  urgent: 'error',
};

export const TASK_CATEGORY_TONE: Readonly<Record<AdminTaskCategory, ChipTone>> = {
  moderation: 'error',
  support: 'info',
  engineering: 'brand',
  product: 'success',
  operations: 'neutral',
  marketing: 'warning',
  finance: 'neutral',
  other: 'muted',
};

export const TASK_CATEGORY_ICON: Readonly<Record<AdminTaskCategory, keyof typeof Ionicons.glyphMap>> = {
  moderation: 'shield-checkmark-outline',
  support: 'help-buoy-outline',
  engineering: 'code-slash-outline',
  product: 'cube-outline',
  operations: 'settings-outline',
  marketing: 'megaphone-outline',
  finance: 'wallet-outline',
  other: 'pricetag-outline',
};
