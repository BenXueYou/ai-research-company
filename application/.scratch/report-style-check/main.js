import { createApp, h } from 'vue';
import Report from '../../web/pages/reports/PlatformReportPage.vue';
import { createRouter, createWebHistory } from 'vue-router';
let count=0; const fixture={organizations:[{id:'seller',name:'卖方机构'},{id:'buyer',name:'买方机构'}],transactions:[{id:'ORDER-123456789',sellerId:'seller',buyerId:'buyer',quantity:'3',amount:'12',status:'完成'}],sales:[{orderId:'ORDER-123456789',sellerId:'seller',buyerId:'buyer',salesAmount:'12',salesCost:'7',grossProfit:'5'}],expenses:[],inventory:{balance:'100',frozen:'2',reserved:'3'},procurement:[{id:'PROC-123456789',reference:'REFERENCE-123456789',event:'采购',internalDelta:'1',upstreamDelta:'2',cashOutflow:'3',expenseDelta:'4',balanceAfter:'100'}],ledger:[{id:'LEDGER-123456789',referenceId:'REF-123456789',organizationId:'buyer',createdAt:'2026-10-28',source:'查询',event:'扣点',amount:'1',balanceAfter:'99',frozenAfter:'0'}],totals:{salesGrossProfit:'5',platformExpenses:'0',afterPlatformExpenses:'5'}};
const router=createRouter({history:createWebHistory(),routes:[{path:'/:pathMatch(.*)*',component:{render:()=>null}}]});
createApp({render:()=>h(Report,{kind:new URLSearchParams(location.search).get('kind')||'profit',request:async path=>{window.calls=(window.calls||[]).concat(path);return fixture}})}).use(router).mount('#app');

