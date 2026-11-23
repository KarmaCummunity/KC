// #2537 — detail lines a job-offer card shows for requirements and estimated salary.
import type { ComponentProps } from 'react';
import type { Ionicons } from '@expo/vector-icons';
import { parseEmploymentJobOfferDetails } from '@kc/domain';
import { employmentSalaryLabelFromParsed } from './employmentSalaryLabel';

type IconName = ComponentProps<typeof Ionicons>['name'];
type Translate = (key: string, options?: Record<string, unknown>) => string;

export interface EmploymentCardDetail {
  readonly icon: IconName;
  readonly text: string;
}

const REQUIREMENTS_PREVIEW_MAX = 80;

/** Shortens a requirements string for a card line. */
function previewRequirements(text: string): string {
  if (text.length <= REQUIREMENTS_PREVIEW_MAX) return text;
  return `${text.slice(0, REQUIREMENTS_PREVIEW_MAX - 1)}…`;
}

/**
 * Card detail lines for an employment job offer. Empty for other worlds or when the offer has
 * neither requirements nor a salary.
 */
export function employmentCardDetails(
  worldSlug: string | null | undefined,
  details: Readonly<Record<string, unknown>> | null | undefined,
  t: Translate,
): EmploymentCardDetail[] {
  if (worldSlug !== 'employment' || !details) return [];
  const parsed = parseEmploymentJobOfferDetails(details);
  const lines: EmploymentCardDetail[] = [];
  const salary = employmentSalaryLabelFromParsed(parsed, t);
  if (salary) lines.push({ icon: 'cash-outline', text: salary });
  if (parsed.requirements) {
    lines.push({ icon: 'list-outline', text: previewRequirements(parsed.requirements) });
  }
  return lines;
}
