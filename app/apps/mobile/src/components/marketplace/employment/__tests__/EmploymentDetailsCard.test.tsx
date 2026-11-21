// @vitest-environment jsdom
// #2537 — job-offer detail card shows requirements and estimated salary.
import { afterEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '@kc/ui';
import { EmploymentDetailsCard } from '../EmploymentDetailsCard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));

afterEach(cleanup);

function renderCard(details: Record<string, unknown>) {
  return render(
    <ThemeProvider mode="light" systemScheme="light" setMode={() => {}}>
      <EmploymentDetailsCard details={details} />
    </ThemeProvider>,
  );
}

describe('EmploymentDetailsCard', () => {
  it('renders nothing when the offer has neither requirements nor salary', () => {
    const { queryByTestId } = renderCard({ role: 'Dev' });
    expect(queryByTestId('employment-section')).toBeNull();
  });

  it('shows requirements and a formatted salary', () => {
    const { getByTestId } = renderCard({
      job_requirements: 'Hebrew',
      estimated_salary_min: 10000,
      estimated_salary_max: 12000,
      salary_pay_period: 'pay_monthly',
    });
    expect(getByTestId('employment-section')).toBeTruthy();
    expect(getByTestId('employment-requirements').textContent).toContain('Hebrew');
    expect(getByTestId('employment-salary').textContent).toContain('jobOffer.salary.rangeMonthly');
  });
});
