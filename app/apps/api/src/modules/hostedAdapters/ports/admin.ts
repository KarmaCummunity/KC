import type {
  IAdminContentRepository,
  IAdminRoleRepository,
  IAdminTaskRepository,
  IAppFlagsAdminRepository,
  ICrmContactsRepository,
  IDemoDataRepository,
  IFinanceAccountsRepository,
  IFinanceDonorsRepository,
  IFinanceLedgerRepository,
  IOrgApplicationsRepository,
  IOrgHierarchyRepository,
  IOrgJobPostingAdminRepository,
  IOrgTransparencyRepository,
  IProdCopyRepository,
  ITimesheetsRepository,
  ITransparencySettingsRepository,
  IWhatsAppAdminRepository,
} from '@kc/application';
import {
  SupabaseAdminContentRepository,
  SupabaseAdminRoleRepository,
  SupabaseAdminTaskRepository,
  SupabaseAppFlagsAdminRepository,
  SupabaseCrmContactsRepository,
  SupabaseDemoDataRepository,
  SupabaseFinanceAccountsRepository,
  SupabaseFinanceDonorsRepository,
  SupabaseFinanceLedgerRepository,
  SupabaseOrgApplicationsRepository,
  SupabaseOrgHierarchyRepository,
  SupabaseOrgJobPostingAdminRepository,
  SupabaseOrgTransparencyRepository,
  SupabaseProdCopyRepository,
  SupabaseTimesheetsRepository,
  SupabaseTransparencySettingsRepository,
  SupabaseWhatsAppAdminRepository,
} from '@kc/infrastructure-supabase';
import { definePort, type PortDefinition } from '../../../platform/ports/portDefinition';
import { adapterClient } from '../adapterClient';

const adminContent = definePort<IAdminContentRepository>({
  name: 'adminContent',
  create: (client) => new SupabaseAdminContentRepository(adapterClient<typeof SupabaseAdminContentRepository>(client)),
  methods: {
    findActiveMembers: 'member',
    searchUsers: 'member',
    searchPosts: 'member',
    searchAudit: 'member',
  },
});

const adminRole = definePort<IAdminRoleRepository>({
  name: 'adminRole',
  create: (client) => new SupabaseAdminRoleRepository(adapterClient<typeof SupabaseAdminRoleRepository>(client)),
  methods: {
    getMyRoles: 'member',
    listAdmins: 'member',
    grantRole: 'member',
    revokeRole: 'member',
    changeRole: 'member',
  },
});

const adminTask = definePort<IAdminTaskRepository>({
  name: 'adminTask',
  create: (client) => new SupabaseAdminTaskRepository(adapterClient<typeof SupabaseAdminTaskRepository>(client)),
  methods: {
    list: 'member',
    openCount: 'member',
    getDetail: 'member',
    create: 'member',
    update: 'member',
    setStatus: 'member',
    assign: 'member',
    addComment: 'member',
    delete: 'member',
  },
});

const appFlagsAdmin = definePort<IAppFlagsAdminRepository>({
  name: 'appFlagsAdmin',
  create: (client) => new SupabaseAppFlagsAdminRepository(adapterClient<typeof SupabaseAppFlagsAdminRepository>(client)),
  methods: {
    setFlag: 'member',
  },
});

const crmContacts = definePort<ICrmContactsRepository>({
  name: 'crmContacts',
  create: (client) => new SupabaseCrmContactsRepository(adapterClient<typeof SupabaseCrmContactsRepository>(client)),
  methods: {
    listOrgs: 'member',
    list: 'member',
    upsert: 'member',
    delete: 'member',
    markContacted: 'member',
  },
});

const demoData = definePort<IDemoDataRepository>({
  name: 'demoData',
  create: (client) => new SupabaseDemoDataRepository(adapterClient<typeof SupabaseDemoDataRepository>(client)),
  methods: {
    getStatus: 'member',
    wipeStep: 'member',
    seedStep: 'member',
  },
});

const financeAccounts = definePort<IFinanceAccountsRepository>({
  name: 'financeAccounts',
  create: (client) => new SupabaseFinanceAccountsRepository(adapterClient<typeof SupabaseFinanceAccountsRepository>(client)),
  methods: {
    list: 'member',
    upsert: 'member',
  },
});

const financeDonors = definePort<IFinanceDonorsRepository>({
  name: 'financeDonors',
  create: (client) => new SupabaseFinanceDonorsRepository(adapterClient<typeof SupabaseFinanceDonorsRepository>(client)),
  methods: {
    summary: 'member',
  },
});

const financeLedger = definePort<IFinanceLedgerRepository>({
  name: 'financeLedger',
  create: (client) => new SupabaseFinanceLedgerRepository(adapterClient<typeof SupabaseFinanceLedgerRepository>(client)),
  methods: {
    list: 'member',
    summary: 'member',
    upsert: 'member',
    delete: 'member',
  },
});

const orgApplications = definePort<IOrgApplicationsRepository>({
  name: 'orgApplications',
  create: (client) => new SupabaseOrgApplicationsRepository(adapterClient<typeof SupabaseOrgApplicationsRepository>(client)),
  methods: {
    list: 'member',
    approve: 'member',
    reject: 'member',
  },
});

const orgHierarchy = definePort<IOrgHierarchyRepository>({
  name: 'orgHierarchy',
  create: (client) => new SupabaseOrgHierarchyRepository(adapterClient<typeof SupabaseOrgHierarchyRepository>(client)),
  methods: {
    getOrgTree: 'member',
    setManager: 'member',
    getHierarchyCensus: 'member',
    setOrgSlug: 'member',
  },
});

const orgJobPostingAdmin = definePort<IOrgJobPostingAdminRepository>({
  name: 'orgJobPostingAdmin',
  create: (client) => new SupabaseOrgJobPostingAdminRepository(adapterClient<typeof SupabaseOrgJobPostingAdminRepository>(client)),
  methods: {
    listOrganizations: 'member',
    setMayPostJobs: 'member',
  },
});

const orgTransparency = definePort<IOrgTransparencyRepository>({
  name: 'orgTransparency',
  create: (client) => new SupabaseOrgTransparencyRepository(adapterClient<typeof SupabaseOrgTransparencyRepository>(client)),
  methods: {
    getPublic: 'public',
  },
});

const prodCopy = definePort<IProdCopyRepository>({
  name: 'prodCopy',
  create: (client) => new SupabaseProdCopyRepository(adapterClient<typeof SupabaseProdCopyRepository>(client)),
  methods: {
    getStatus: 'member',
    deleteAll: 'member',
  },
});

const timesheets = definePort<ITimesheetsRepository>({
  name: 'timesheets',
  create: (client) => new SupabaseTimesheetsRepository(adapterClient<typeof SupabaseTimesheetsRepository>(client)),
  methods: {
    list: 'member',
    upsert: 'member',
    submit: 'member',
    approve: 'member',
    reject: 'member',
    delete: 'member',
  },
});

const transparencySettings = definePort<ITransparencySettingsRepository>({
  name: 'transparencySettings',
  create: (client) => new SupabaseTransparencySettingsRepository(adapterClient<typeof SupabaseTransparencySettingsRepository>(client)),
  methods: {
    get: 'member',
    set: 'member',
  },
});

const whatsAppAdmin = definePort<IWhatsAppAdminRepository>({
  name: 'whatsAppAdmin',
  create: (client) => new SupabaseWhatsAppAdminRepository(adapterClient<typeof SupabaseWhatsAppAdminRepository>(client)),
  methods: {
    getChannel: 'member',
    setChannelEnabled: 'member',
    overview: 'member',
    listConsent: 'member',
    listOutbound: 'member',
    listRateHits: 'member',
    listRecentMatches: 'member',
    listConversations: 'member',
    resend: 'member',
    blockUser: 'member',
    listReviews: 'member',
    resolveReview: 'member',
    listTemplates: 'member',
    getSendLimits: 'member',
    setSendLimits: 'member',
    setTemplateStatus: 'member',
  },
});

export const ADMIN_PORTS: readonly PortDefinition[] = [adminContent, adminRole, adminTask, appFlagsAdmin, crmContacts, demoData, financeAccounts, financeDonors, financeLedger, orgApplications, orgHierarchy, orgJobPostingAdmin, orgTransparency, prodCopy, timesheets, transparencySettings, whatsAppAdmin];
