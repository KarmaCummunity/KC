import { describe, expect, it, vi } from 'vitest';
import type {
  AdminSurveyOverviewItem,
  AdminFeedbackEntry,
  PmfSurveyReport,
} from '@kc/domain';
import type { ISurveyAdminRepository } from '../../ports/ISurveyAdminRepository';
import { GetAdminSurveyOverviewUseCase } from '../GetAdminSurveyOverviewUseCase';
import { GetAdminSurveyResultsUseCase } from '../GetAdminSurveyResultsUseCase';
import { ListUserFeedbackUseCase } from '../ListUserFeedbackUseCase';
import { GetPmfSurveyReportUseCase } from '../GetPmfSurveyReportUseCase';

const PMF_REPORT: PmfSurveyReport = {
  slug: 'pmf-sean-ellis',
  titleHe: 't',
  version: 1,
  promptHe: 'p',
  minActiveDays14d: 2,
  respondentsTotal: 12,
  respondentsQualified: 10,
  options: [
    { key: 'very_disappointed', labelHe: 'v', count: 5, retentionBase: 4, retained: 2 },
    { key: 'somewhat_disappointed', labelHe: 's', count: 3, retentionBase: 0, retained: 0 },
    { key: 'not_disappointed', labelHe: 'n', count: 2, retentionBase: 0, retained: 0 },
  ],
};

function makeRepo(over: Partial<ISurveyAdminRepository> = {}): ISurveyAdminRepository {
  return {
    listOverview: vi.fn(async () => [] as AdminSurveyOverviewItem[]),
    getResults: vi.fn(async () => ({
      slug: 's',
      titleHe: 't',
      version: 1,
      respondentCount: 0,
      questions: [],
      respondents: [],
    })),
    listFeedback: vi.fn(async () => [] as AdminFeedbackEntry[]),
    getPmfReport: vi.fn(async () => PMF_REPORT),
    ...over,
  };
}

describe('admin survey use cases', () => {
  it('GetAdminSurveyOverviewUseCase delegates to repo.listOverview', async () => {
    const repo = makeRepo();
    await new GetAdminSurveyOverviewUseCase(repo).execute();
    expect(repo.listOverview).toHaveBeenCalledTimes(1);
  });

  it('GetAdminSurveyResultsUseCase forwards the slug', async () => {
    const repo = makeRepo();
    await new GetAdminSurveyResultsUseCase(repo).execute('ux-experience');
    expect(repo.getResults).toHaveBeenCalledWith('ux-experience');
  });

  it('ListUserFeedbackUseCase applies default pagination', async () => {
    const repo = makeRepo();
    await new ListUserFeedbackUseCase(repo).execute();
    expect(repo.listFeedback).toHaveBeenCalledWith(50, 0);
  });

  it('ListUserFeedbackUseCase forwards explicit pagination', async () => {
    const repo = makeRepo();
    await new ListUserFeedbackUseCase(repo).execute({ limit: 10, offset: 20 });
    expect(repo.listFeedback).toHaveBeenCalledWith(10, 20);
  });

  it('GetPmfSurveyReportUseCase reads the seeded survey by default and summarizes it', async () => {
    const repo = makeRepo();
    const view = await new GetPmfSurveyReportUseCase(repo).execute();
    expect(repo.getPmfReport).toHaveBeenCalledWith('pmf-sean-ellis');
    expect(view.report).toBe(PMF_REPORT);
    expect(view.summary.sampleSize).toBe(10);
    expect(view.summary.veryDisappointedShare).toBe(0.5);
    expect(view.summary.options[0]?.retentionRate).toBe(0.5);
  });

  it('GetPmfSurveyReportUseCase propagates repository failures', async () => {
    const failure = new Error('forbidden');
    const repo = makeRepo({ getPmfReport: vi.fn(async () => Promise.reject(failure)) });
    await expect(new GetPmfSurveyReportUseCase(repo).execute('pmf-sean-ellis')).rejects.toBe(failure);
  });
});
