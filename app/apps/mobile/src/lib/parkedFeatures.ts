// Features whose backend is not part of the production baseline (docs/db/app-migration-map.md).
// Their adapters make no call and reject with `BackendUnavailableError`; these switches keep
// the entry points (navigation, dashboard cards, settings rows) out of sight, and the screens
// themselves render `ParkedFeatureNotice` when reached by a direct link. Turn a switch on in
// the change that adds the backend objects and moves the adapter back onto them.

/** FR-ADMIN-018 admin tasks — migration 0034 (admin_task_* RPCs). */
export const ADMIN_TASKS_AVAILABLE: boolean = true;

/** FR-ADMIN-032 CRM contacts per organization — migration 0035 (crm_* RPCs). */
export const CRM_AVAILABLE: boolean = true;

/** FR-ADMIN-033 staff timesheets — migration 0036 (timesheet_* RPCs). */
export const TIMESHEETS_AVAILABLE: boolean = true;

/** M22: WhatsApp bot linking and its admin console — the `integrations` module (whatsapp_* migrations).
 *  The launch flag `launch_whatsapp_bot_enabled` still decides per environment whether it shows. */
export const WHATSAPP_BOT_AVAILABLE: boolean = true;
