// Features whose backend is not part of the production baseline (docs/db/app-migration-map.md).
// Their adapters make no call and reject with `BackendUnavailableError`; these switches keep
// the entry points (navigation, dashboard cards, settings rows) out of sight, and the screens
// themselves render `ParkedFeatureNotice` when reached by a direct link. Turn a switch on in
// the change that adds the backend objects and moves the adapter back onto them.

/** M19: admin tasks, CRM contacts and timesheets — no tables or RPCs in the baseline. */
export const BACK_OFFICE_TOOLS_AVAILABLE: boolean = false;

/** M22: WhatsApp bot linking and its admin console — waits for the `integrations` module. */
export const WHATSAPP_BOT_AVAILABLE: boolean = false;
