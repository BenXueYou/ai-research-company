import { nextTick } from 'vue';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import type { Pinia } from 'pinia';
import { useSessionStore } from '../stores/session';
import MemberManagement from '../pages/organizations/MemberManagement.vue';
import EmptyRoute from './EmptyRoute.vue';
import CompanyProfilesPage from '../pages/companies/CompanyProfilesPage.vue';
import TerminalSearchPage from '../pages/companies/TerminalSearchPage.vue';
import SettingsRoute from './SettingsRoute.vue';
import RoleHelpPage from '../pages/help/RoleHelpPage.vue';
import UpstreamMonitorPage from '../pages/upstream/UpstreamMonitorPage.vue';
import ReconciliationPage from '../pages/upstream/ReconciliationPage.vue';
import PlatformReportPage from '../pages/reports/PlatformReportPage.vue';
import PlatformBusinessData from '../pages/reports/PlatformBusinessData.vue';
import PlatformPointOrdersPage from '../pages/commerce/PlatformPointOrdersPage.vue';
import DistributionPointOrdersPage from '../pages/commerce/DistributionPointOrdersPage.vue';
import PlatformProcurement from '../pages/commerce/PlatformProcurement.vue';
import PlatformOrganizationsPage from '../pages/organizations/PlatformOrganizationsPage.vue';
import DistributionOrganizationsPage from '../pages/organizations/DistributionOrganizationsPage.vue';
import PlatformSettingsPage from '../pages/commerce/PlatformSettingsPage.vue';
import UMailResourceSettings from '../pages/email/UMailResourceSettings.vue';
import PlatformEmailQuota from '../pages/email/PlatformEmailQuota.vue';
import PlatformOverviewPage from '../pages/overview/PlatformOverviewPage.vue';
import TerminalUsagePage from '../pages/reports/TerminalUsagePage.vue';
import DistributionProfitPage from '../pages/reports/DistributionProfitPage.vue';
import EmailRecordsPage from '../pages/email/EmailRecordsPage.vue';
import TeamSendingSettingsPage from '../pages/email/TeamSendingSettingsPage.vue';

type Role = 'platform' | 'distributor' | 'admin' | 'sales';
declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    roles?: Role[];
    business?: boolean;
    navigation?: { label: string; group?: string; order: number };
    breadcrumbs?: { label: string; path?: string }[];
  }
}
interface NavigationItem {
  path: string;
  label: string;
  roles: Role[];
}

export const navigation: NavigationItem[] = [
  { path: '/platform/overview', label: '运营概览', roles: ['platform'] },
  { path: '/platform/organizations', label: '下级管理', roles: ['platform'] },
  { path: '/platform/ledger', label: '点数与账务', roles: ['platform'] },
  { path: '/platform/reconciliation', label: '上游与对账', roles: ['platform'] },
  { path: '/platform/settings', label: '平台设置', roles: ['platform'] },
  { path: '/distribution/organizations', label: '下级管理', roles: ['distributor'] },
  { path: '/distribution/orders', label: '点数订单', roles: ['distributor'] },
  { path: '/distribution/profit', label: '交易与利润', roles: ['distributor'] },
  { path: '/terminal/search', label: '找企业', roles: ['admin', 'sales'] },
  { path: '/terminal/profiles', label: '企业档案库', roles: ['admin', 'sales'] },
  { path: '/terminal/emails', label: '邮件发送记录', roles: ['admin', 'sales'] },
  { path: '/terminal/sending-settings', label: '团队发信设置', roles: ['admin', 'sales'] },
  { path: '/terminal/members', label: '成员管理', roles: ['admin', 'sales'] },
  { path: '/terminal/usage', label: '点数用量', roles: ['admin', 'sales'] }
];

const businessPages: Record<string, NonNullable<RouteRecordRaw['component']>> = {
  '/terminal/search': TerminalSearchPage,
  '/terminal/profiles': CompanyProfilesPage,
  '/terminal/members': MemberManagement,
  '/platform/overview': PlatformOverviewPage,
  '/platform/reconciliation': ReconciliationPage,
  '/platform/organizations': PlatformOrganizationsPage,
  '/distribution/organizations': DistributionOrganizationsPage,
  '/platform/ledger': PlatformPointOrdersPage,
  '/distribution/orders': DistributionPointOrdersPage,
  '/platform/settings': PlatformSettingsPage,
  '/terminal/usage': TerminalUsagePage,
  '/distribution/profit': DistributionProfitPage,
  '/terminal/sending-settings': TeamSendingSettingsPage,
  '/terminal/emails': EmailRecordsPage
};
const businessRoutes: RouteRecordRaw[] = navigation.map(item => {
  const component = businessPages[item.path];
  if (!component) throw new Error('Business route requires a real page: ' + item.path);
  return {
    path: item.path,
    name: item.path.slice(1).replaceAll('/', '-'),
    component,
    meta: { title: item.label, roles: item.roles, business: true }
  };
});

const routes: RouteRecordRaw[] = [
  ...businessRoutes,
  {
    path: '/platform/ledger/procurement',
    component: PlatformProcurement,
    meta: { title: '采购与费用', roles: ['platform'], business: true }
  },
  {
    path: '/platform/settings/umail',
    component: UMailResourceSettings,
    meta: { title: 'U-Mail 企业资源', roles: ['platform'], business: true }
  },
  {
    path: '/platform/settings/email-quota',
    component: PlatformEmailQuota,
    meta: { title: '企业邮件日额度', roles: ['platform'], business: true }
  },
  {
    path: '/platform/organizations/business-data',
    component: PlatformBusinessData,
    meta: { title: '业务数据查看', roles: ['platform'], business: true }
  },
  {
    path: '/platform/ledger/profit',
    component: PlatformReportPage,
    props: { kind: 'profit' },
    meta: { title: '交易与利润', roles: ['platform'], business: true }
  },
  {
    path: '/platform/ledger/flows',
    component: PlatformReportPage,
    props: { kind: 'ledger' },
    meta: { title: '账务流水', roles: ['platform'], business: true }
  },
  {
    path: '/platform/reconciliation/upstream',
    name: 'platform-upstream',
    component: UpstreamMonitorPage,
    meta: { title: '腾道共享账号', roles: ['platform'], business: true }
  },
  { 
    path: '/help', 
    name: 'help', 
    component: RoleHelpPage, 
    meta: { 
      title: '帮助中心', 
      roles: ['platform', 'distributor', 'admin', 'sales'] 
    } 
  },
  { 
    path: '/account/settings', 
    name: 'account-settings', 
    component: SettingsRoute, 
    meta: { 
      title: '账号设置', roles: ['platform', 'distributor', 'admin', 'sales'] 
    } 
  },
  { path: '/:pathMatch(.*)*', name: 'unknown', component: EmptyRoute }
];

// All entries below point to existing pages. Groups have no navigation action.
const platformNavigation: Record<string, { label: string; group?: string; order: number }> = {
  '/platform/overview': { label: '运营概览', order: 0 },
  '/platform/organizations': { label: '下级管理', order: 1 },
  '/platform/ledger': { label: '点数订单', group: '点数与账务', order: 2 },
  '/platform/ledger/procurement': { label: '采购与费用', group: '点数与账务', order: 2.5 },
  '/platform/ledger/profit': { label: '交易与利润', group: '点数与账务', order: 3 },
  '/platform/ledger/flows': { label: '账务流水', group: '点数与账务', order: 4 },
  '/platform/reconciliation/upstream': { label: '上游账号监控', group: '上游与对账', order: 5 },
  '/platform/reconciliation': { label: '查询异常核对', group: '上游与对账', order: 6 },
  '/platform/settings': { label: '计价配置', group: '平台设置', order: 7 },
  '/platform/settings/umail': { label: 'U-Mail 企业资源', group: '平台设置', order: 8 },
  '/platform/settings/email-quota': { label: '企业邮件日额度', group: '平台设置', order: 9 }
};
for (const record of routes) {
  if (!record.meta?.roles) continue;
  const legacy = navigation.find(entry =>
    entry.path === record.path
  );
  const metadata = platformNavigation[record.path] ?? (legacy ? { label: legacy.label, order: navigation.indexOf(legacy) } : undefined);
  if (metadata) {
    record.meta.navigation = metadata;
    record.meta.breadcrumbs = [
      ...('group' in metadata && metadata.group ? [{ label: metadata.group }] : []),
      { label: metadata.label }
    ];
  }
}
for (const record of routes) {
  if (record.path.startsWith('/platform/settings/')) record.meta!.breadcrumbs![0].path = '/platform/settings';
}
const organizations = routes.find(record => record.path === '/platform/organizations')!;
organizations.meta!.breadcrumbs = [{ label: '下级管理' }, { label: '直属下级' }];
const businessData = routes.find(record => record.path === '/platform/organizations/business-data')!;
businessData.meta!.breadcrumbs = [
  { label: '下级管理', path: '/platform/organizations' },
  { label: '业务数据查看' }
];

export function defaultPath(role: string): string {
  if (role === 'platform') return '/platform/overview';
  if (role === 'distributor') return '/distribution/organizations';
  return '/terminal/search';
}

export function isBusinessPath(path: string, role: string): boolean {
  path = path.split(/[?#]/, 1)[0];
  if (path === '/platform/ledger/procurement' && role === 'platform') return true;
  if (['/platform/settings/umail', '/platform/settings/email-quota'].includes(path) && role === 'platform') return true;
  return (['/platform/organizations/business-data', '/platform/reconciliation/upstream', '/platform/ledger/profit', '/platform/ledger/flows'].includes(path) && role === 'platform') ||
    navigation.some(item => item.path === path && item.roles.includes(role as Role));
}

export function createConsoleRouter(pinia: Pinia) {
  const positions = new Map<number, number>();
  let currentPosition: number | undefined;
  const router = createRouter({
    history: createWebHistory(),
    routes,
    async scrollBehavior(_to, _from, savedPosition) {
      await nextTick();
      const main = document.getElementById('console-main');
      const position = window.history.state?.position as number | undefined;
      const restored = savedPosition && position !== undefined ? positions.get(position) : undefined;
      if (main) {
        if (restored !== undefined) main.scrollTop = restored;
        else main.scrollTop = 0;
      }
      return false as const;
    }
  });
  router.afterEach((_to, _from, failure) => {
    if (!failure) currentPosition = window.history.state?.position as number | undefined;
  });
  router.beforeEach(async to => {
    const main = document.getElementById('console-main');
    if (main && currentPosition !== undefined) positions.set(currentPosition, main.scrollTop);
    const auth = useSessionStore(pinia);
    await auth.initialize();
    if (auth.status !== 'authenticated' || !auth.session || auth.session.mustChange) return true;
    const role = auth.session.role;
    if (to.name === 'unknown') return { path: defaultPath(role), replace: true };
    const roles = to.meta.roles;
    if (!roles?.includes(role as Role)) return { path: defaultPath(role), replace: true };
    return true;
  });
  return router;
}
