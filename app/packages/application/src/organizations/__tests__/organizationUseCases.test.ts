import { describe, expect, it, vi } from 'vitest';
import { OrgError, type SubmitOrgApplicationInput } from '@kc/domain';
import type { IOrganizationsRepository } from '../IOrganizationsRepository';
import { AddOrgMemberUseCase, SubmitOrgApplicationUseCase } from '../organizationUseCases';

function repo(): IOrganizationsRepository {
  return {
    submitApplication: vi.fn().mockResolvedValue('app-1'),
    getMyLatestApplication: vi.fn().mockResolvedValue(null),
    listMyOrganizations: vi.fn().mockResolvedValue([]),
    listMembers: vi.fn().mockResolvedValue([]),
    addMember: vi.fn().mockResolvedValue(undefined),
    removeMember: vi.fn().mockResolvedValue(undefined),
  };
}

const input: SubmitOrgApplicationInput = {
  orgName: '  בנק המזון  ',
  orgDescription: ' We share food. ',
  contactEmail: ' team@foodbank.org.il ',
  contactPhone: '  ',
  websiteUrl: '',
  declaredNonprofit: true,
};

describe('SubmitOrgApplicationUseCase', () => {
  it('sends a trimmed application with empty optionals as null', async () => {
    const r = repo();
    await expect(new SubmitOrgApplicationUseCase(r).execute(input)).resolves.toBe('app-1');
    expect(r.submitApplication).toHaveBeenCalledWith({
      orgName: 'בנק המזון',
      orgDescription: 'We share food.',
      contactEmail: 'team@foodbank.org.il',
      contactPhone: null,
      websiteUrl: null,
      declaredNonprofit: true,
    });
  });

  it('stops an invalid application before the server', async () => {
    const r = repo();
    await expect(
      new SubmitOrgApplicationUseCase(r).execute({ ...input, declaredNonprofit: false }),
    ).rejects.toMatchObject({ code: 'org_nonprofit_declaration_required' });
    expect(r.submitApplication).not.toHaveBeenCalled();
  });
});

describe('AddOrgMemberUseCase', () => {
  it('strips a leading @ from the handle', async () => {
    const r = repo();
    await new AddOrgMemberUseCase(r).execute({ orgId: 'o1', shareHandle: ' @dana ', role: 'org_volunteer' });
    expect(r.addMember).toHaveBeenCalledWith('o1', 'dana', 'org_volunteer');
  });

  it('refuses an empty handle without a server call', async () => {
    const r = repo();
    await expect(
      new AddOrgMemberUseCase(r).execute({ orgId: 'o1', shareHandle: ' @ ', role: 'org_volunteer' }),
    ).rejects.toBeInstanceOf(OrgError);
    expect(r.addMember).not.toHaveBeenCalled();
  });
});
