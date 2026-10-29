import { createApp, h } from 'vue';
import { createRouter, createWebHashHistory } from 'vue-router';
import TerminalSearchPage from '../../web/pages/companies/TerminalSearchPage.vue';
import '../../web/styles';
import { provideFormLeave } from '../../web/router/formLeave';
const calls = window.calls = [];
const request = async (path, body) => {
  calls.push({ path, body });
  if (path === 'company-profiles') return { profiles: [], account: null, ledger: [] };
  if (path === 'company-searches') return { page: 1, size: 20, total: 0, chargedInternalPoints: '0.0000', content: [] };
  if (path === 'product-searches/quote') return { ...body, pageId: 'page-internal-7', state: 'quoted', coefficient: '1.0000', maximumPoints: '2.0000', chargedPoints: null, total: null, content: [] };
  throw new Error('Unexpected request: ' + path);
};
const router = createRouter({ history: createWebHashHistory(), routes: [{ path: '/', component: TerminalSearchPage }] });
createApp({ setup() { provideFormLeave(router, () => true); return () => h('main', { style: 'padding:24px; background:#f8fafc;min-height:100vh' }, h(TerminalSearchPage, { request })); } }).use(router).mount('#app');
