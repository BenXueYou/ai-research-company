import { nextTick } from 'vue';
import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import type { Pinia } from 'pinia';
import { useSessionStore } from '../stores/session';
import EmptyRoute from './EmptyRoute.vue';
import SettingsRoute from './SettingsRoute.vue';
import RoleHelpPage from '../pages/help/RoleHelpPage.vue';
import UpstreamMonitorPage from '../pages/upstream/UpstreamMonitorPage.vue';
import ReconciliationPage from '../pages/upstream/ReconciliationPage.vue';
import PlatformReportPage from '../pages/reports/PlatformReportPage.vue';
import PlatformBusinessData from '../pages/reports/PlatformBusinessData.vue';
import PointOrders from '../pages/commerce/PointOrders.vue';
import PlatformOrganizationsPage from '../pages/organizations/PlatformOrganizationsPage.vue';
import PlatformSettingsPage from '../pages/commerce/PlatformSettingsPage.vue';
import UMailResourceSettings from '../pages/email/UMailResourceSettings.vue';
import PlatformEmailQuota from '../pages/email/PlatformEmailQuota.vue';

type Role = 'platform' | 'distributor' | 'admin' | 'sales';
declare module 'vue-router' {
  interface RouteMeta {
    title?: string;
    roles?: Role[];
    target?: string;
    business?: boolean;
    navigation?: { label: string; group?: string; order: number };
    breadcrumbs?: { label: string; path?: string }[];
  }
}
interface NavigationItem {
  path: string;
  label: string;
  roles: Role[];
  target?: string;
}

export const navigation: NavigationItem[] = [
  { path: '/platform/overview', label: '运营概览', roles: ['platform'] },
  { path: '/platform/organizations', label: '下级管理', roles: ['platform'] },
  { path: '/platform/ledger', label: '点数与账务', roles: ['platform'] },
  { path: '/platform/reconciliation', label: '上游与对账', roles: ['platform'] },
  { path: '/platform/settings', label: '平台设置', roles: ['platform'] },
  { path: '/distribution/organizations', label: '下级管理', roles: ['distributor'], target: 'compat-organizations' },
  { path: '/distribution/orders', label: '点数订单', roles: ['distributor'], target: 'compat-orders' },
  { path: '/distribution/profit', label: '交易与利润', roles: ['distributor'], target: 'compat-usage' },
  { path: '/terminal/search', label: '找企业', roles: ['admin', 'sales'], target: 'company-search' },
  { path: '/terminal/profiles', label: '企业档案库', roles: ['admin', 'sales'], target: 'company-search' },
  { path: '/terminal/emails', label: '邮件发送记录', roles: ['admin', 'sales'], target: 'compat-emails' },
  { path: '/terminal/sending-settings', label: '团队发信设置', roles: ['admin', 'sales'], target: 'compat-sending' },
  { path: '/terminal/members', label: '成员管理', roles: ['admin', 'sales'], target: 'compat-members' },
  { path: '/terminal/usage', label: '点数用量', roles: ['admin', 'sales'], target: 'compat-usage' }
];

const businessRoutes: RouteRecordRaw[] = navigation.map(item => ({
  path: item.path,
  name: item.path.slice(1).replaceAll('/', '-'),
  component: item.path === '/platform/reconciliation' ? ReconciliationPage :
    item.path === '/platform/organizations' ? PlatformOrganizationsPage :
    item.path === '/platform/ledger' ? PointOrders :
    item.path === '/platform/settings' ? PlatformSettingsPage : EmptyRoute,
  meta: { title: item.label, roles: item.roles, target: item.target, business: true }
}));

const routes: RouteRecordRaw[] = [
  ...businessRoutes,
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
    async scrollBehavior(to, _from, savedPosition) {
      await nextTick();
      const main = document.getElementById('console-main');
      const position = window.history.state?.position as number | undefined;
      const restored = savedPosition && position !== undefined ? positions.get(position) : undefined;
      if (main) {
        if (restored !== undefined) main.scrollTop = restored;
        else {
          main.scrollTop = 0;
          const target = typeof to.meta.target === 'string' ? document.getElementById(to.meta.target) : null;
          if (target) main.scrollTop = target.getBoundingClientRect().top - main.getBoundingClientRect().top;
        }
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
