// @vitest-environment jsdom
// FR-ADMIN-021 / KC#1058 — the PMF card shows the score, margin of error, benchmark,
// sample size and a small-sample warning, and never a fake 0% for an empty survey.
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { summarizePmfSurvey, type PmfSurveyReport } from '@kc/domain';
// eslint-disable-next-line no-restricted-imports -- the test asserts the rendered Hebrew copy, which the mocked useLocaleBundle serves
import { adminSurveysHe } from '../../../../i18n/locales/he/modules/adminSurveys';

vi.mock('../../../../i18n/useLocaleBundle', () => ({
  useLocaleBundle: () => ({ admin: { surveys: adminSurveysHe } }),
}));

import { PmfReportCard } from '../PmfReportCard';

function view(very: number, somewhat: number, not: number) {
  const report: PmfSurveyReport = {
    slug: 'pmf-sean-ellis',
    titleHe: 't',
    version: 1,
    promptHe: 'p',
    minActiveDays14d: 2,
    respondentsTotal: very + somewhat + not + 5,
    respondentsQualified: very + somewhat + not,
    options: [
      { key: 'very_disappointed', labelHe: 'מאוד מאוכזב/ת', count: very, retentionBase: 2, retained: 1 },
      { key: 'somewhat_disappointed', labelHe: 'קצת מאוכזב/ת', count: somewhat, retentionBase: 0, retained: 0 },
      { key: 'not_disappointed', labelHe: 'לא מאוכזב/ת', count: not, retentionBase: 0, retained: 0 },
    ],
  };
  return { report, summary: summarizePmfSurvey(report) };
}

describe('PmfReportCard', () => {
  // Vitest config sets `globals: false`, so testing-library's automatic cleanup is not wired.
  afterEach(() => cleanup());

  it('shows the score, margin of error and an above-target badge', () => {
    render(<PmfReportCard view={view(50, 30, 20)} isLoading={false} />);
    expect(screen.getByText('50%')).toBeTruthy();
    expect(screen.getByText(adminSurveysHe.pmf.marginOfError('9.8%'))).toBeTruthy();
    expect(screen.getByText(adminSurveysHe.pmf.aboveBenchmark)).toBeTruthy();
    expect(screen.getByText(adminSurveysHe.pmf.sample(100, 105))).toBeTruthy();
    expect(screen.queryByText(adminSurveysHe.pmf.smallSample(40))).toBeNull();
    expect(screen.getByText(adminSurveysHe.pmf.retention('50%', 1, 2))).toBeTruthy();
  });

  it('warns on a small sample below the target', () => {
    render(<PmfReportCard view={view(3, 4, 3)} isLoading={false} />);
    expect(screen.getByText(adminSurveysHe.pmf.belowBenchmark)).toBeTruthy();
    expect(screen.getByText(adminSurveysHe.pmf.smallSample(40))).toBeTruthy();
  });

  it('shows the empty state instead of a 0% score when nobody qualified', () => {
    render(<PmfReportCard view={view(0, 0, 0)} isLoading={false} />);
    expect(screen.getByText(adminSurveysHe.pmf.emptyTitle)).toBeTruthy();
    expect(screen.queryByText('0%')).toBeNull();
  });

  it('shows the error text when the report could not load', () => {
    render(<PmfReportCard view={null} isLoading={false} />);
    expect(screen.getByText(adminSurveysHe.pmf.errorTitle)).toBeTruthy();
  });
});
