// The back-office tools (admin tasks, CRM, timesheets; M19) have no backend in the production
// baseline: every adapter method must reject with BackendUnavailableError naming the old RPC,
// so the screens degrade instead of failing on an unknown error.
import { describe, expect, it } from 'vitest';
import { BackendUnavailableError } from '@kc/domain';
import { SupabaseAdminTaskRepository } from '../SupabaseAdminTaskRepository';
import { SupabaseCrmContactsRepository } from '../SupabaseCrmContactsRepository';
import { SupabaseTimesheetsRepository } from '../SupabaseTimesheetsRepository';

async function expectUnavailable(call: Promise<unknown>, object: string): Promise<void> {
  const error = await call.catch((e: unknown) => e);
  expect(error).toBeInstanceOf(BackendUnavailableError);
  expect(error).toMatchObject({ object, kind: 'function' });
}

describe('parked back-office tools', () => {
  it('admin tasks (M19) report every call as unavailable', async () => {
    const repo = new SupabaseAdminTaskRepository();
    await expectUnavailable(repo.list({}), 'rpc:admin_task_list');
    await expectUnavailable(repo.getDetail('t1'), 'rpc:admin_task_detail');
    await expectUnavailable(repo.create({ title: 'x' } as never), 'rpc:admin_task_create');
    await expectUnavailable(repo.update('t1', {}), 'rpc:admin_task_update');
    await expectUnavailable(repo.setStatus('t1', 'done'), 'rpc:admin_task_set_status');
    await expectUnavailable(repo.assign('t1', null), 'rpc:admin_task_assign');
    await expectUnavailable(repo.addComment('t1', 'hi'), 'rpc:admin_task_add_comment');
    await expectUnavailable(repo.delete('t1'), 'rpc:admin_task_delete');
  });

  it('CRM contacts and timesheets (M19) report every call as unavailable', async () => {
    const crm = new SupabaseCrmContactsRepository();
    await expectUnavailable(crm.list({}), 'rpc:crm_contact_list');
    await expectUnavailable(crm.upsert({ name: 'A' } as never), 'rpc:crm_contact_upsert');
    await expectUnavailable(crm.delete('c1'), 'rpc:crm_contact_delete');
    await expectUnavailable(crm.markContacted('c1'), 'rpc:crm_contact_mark_contacted');
    const time = new SupabaseTimesheetsRepository();
    await expectUnavailable(time.list({}), 'rpc:timesheet_list');
    await expectUnavailable(time.upsert({} as never), 'rpc:timesheet_upsert');
    await expectUnavailable(time.submit('e1'), 'rpc:timesheet_submit');
    await expectUnavailable(time.approve('e1'), 'rpc:timesheet_approve');
    await expectUnavailable(time.reject('e1', 'no'), 'rpc:timesheet_reject');
    await expectUnavailable(time.delete('e1'), 'rpc:timesheet_delete');
  });
});
