<script setup lang="ts">
import { ElButton } from 'element-plus';
import { computed } from 'vue';
import HelpWalkthrough from './components/HelpWalkthrough.vue';
import { walkthroughs } from './walkthroughs';

const props = defineProps<{ role: string }>();
const emit = defineEmits<{ navigate: [path: string] }>();

interface Guide {
  title: string;
  text: string;
  path?: string;
  link?: string;
}

const guides: Record<string, Guide[]> = {
  platform: [
    { title: '直属开户与账号交付', text: '在下级管理中为直属下级开户，核对组织和管理员信息。开户后及时安全交付临时凭据；临时密码有效期 72 小时，首次登录必须改密。直属管理员密码重置也在授权范围内进行。', path: '/platform/organizations', link: '进入下级管理' },
    { title: '直属点数交易', text: '为直属下级建立点数订单，核对数量、价格和线下收款，再依订单状态处理预留、完整划拨或退款。库存不足、结果待确认等情况以订单现场提示和核对结果为准。', path: '/platform/ledger', link: '进入点数与账务' },
    {
      title: '采购与平台承担费用',
      text: '销售用途采购与补足上游额度分别留账；补足额度不生成新的内部可分配点数。已确认的损耗应关联核对，避免重复确认费用。销售毛利扣除平台承担费用后的结果不等于净利润。',
      path: '/platform/ledger/procurement',
      link: '进入采购与费用'
    },
    {
      title: '计价配置',
      text: '在平台设置中维护接口点数单价、点数换算系数和最低加价率，核对生效条件及覆盖范围后再提交。采购入账和费用登记在点数与账务中处理。',
      path: '/platform/settings',
      link: '进入计价配置'
    },
    { title: '计价与上游核对', text: '接口点数单价、点数换算系数和最低加价率各有不同含义。内部可用余额与上游余额不能相加；上游状态更新需要主动操作，查询异常和迟到结果按现场依据核对。', path: '/platform/reconciliation', link: '进入上游与对账' }
  ],
  distributor: [
    { title: '直属开户与凭据', text: '在下级管理中为直属下级开户，并在关闭凭据前安全交付临时密码。临时密码有效期 72 小时，首次登录必须改密；重置和定价按直属关系及现有权限进行。', path: '/distribution/organizations', link: '进入下级管理' },
    { title: '点数订单与利润', text: '与直属下级交易时核对订单、线下收款和库存；按订单状态完成预留、完整划拨或符合条件的退款。实际结果和异常处理以订单现场提示为准。', path: '/distribution/orders', link: '进入点数订单' },
    { title: '多层查看范围', text: '授权范围内的多层下级账户查看与直属业务操作不同；查看不赋予跨级开户、定价、交易或密码重置权限，也不提供下级客户内容。', path: '/distribution/profit', link: '进入交易与利润' }
  ],
  admin: [
    { title: '搜索与建档', text: '从找企业输入搜索条件，逐步核对候选企业和身份，再按页面提示确认收费查询与建档。费用、风险和校验提示以操作现场为准。', path: '/terminal/search', link: '进入找企业' },
    { title: '联系人与发信', text: '在企业业务中选择联系人、核对归属和收件地址，预览并确认内容后按页面提示确认额度及发送。发送结果和待确认事项可在邮件发送记录中查看。', path: '/terminal/emails', link: '进入邮件发送记录' },
    { title: '团队与成员', text: '管理员可按现有权限维护团队发信设置及成员。创建成员后安全交付临时凭据；临时密码有效期 72 小时，首次登录必须改密。', path: '/terminal/members', link: '进入成员管理' }
  ],
  sales: [
    { title: '搜索与建档', text: '按授权使用共享企业业务，从找企业核对候选企业和身份，再按页面提示确认收费查询与建档。费用、风险和校验提示以操作现场为准。', path: '/terminal/search', link: '进入找企业' },
    { title: '联系人与发信', text: '按授权选择联系人并核对归属和收件地址，预览确认内容，再按现场提示确认额度与发送；可查看授权范围内的发送记录。', path: '/terminal/emails', link: '进入邮件发送记录' },
    { title: '团队权限', text: '业务员按授权使用共享业务数据，不能维护团队发信设置或团队成员。需要调整时请联系本企业管理员。' }
  ]
};
const roleNames: Record<string, string> = { platform: '平台运营', distributor: '分销管理员', admin: '终端企业管理员', sales: '业务员' };
const currentGuides = computed(() => guides[props.role] ?? []);
const roleName = computed(() => roleNames[props.role] ?? '当前账号');
</script>

<template>
  <section class="role-help" aria-label="帮助中心">
    <header class="help-heading">
      <h1>帮助中心</h1>
      <p>{{ roleName }}操作指南</p>
      <p>对照页面截图了解操作步骤，点击图片可放大查看。截图使用示例数据，具体状态与可用操作以当前页面为准。</p>
    </header>
    <div class="help-guides">
      <section v-for="guide in currentGuides" :key="guide.title" class="help-section help-guide">
        <h2>{{ guide.title }}</h2>
        <p>{{ guide.text }}</p>
        <HelpWalkthrough :walkthrough="walkthroughs[guide.path ?? 'permissions']" />
        <el-button
          v-if="guide.path"
          native-type="button"
          class="help-link"
          @click="emit('navigate', guide.path)"
        >{{ guide.link }}<span aria-hidden="true"> →</span></el-button>
      </section>
    </div>
    <section class="help-section help-faq">
      <h2>账号与常见问题</h2>
      <HelpWalkthrough :walkthrough="walkthroughs.account" />
      <h3>修改密码</h3>
      <p>在账号设置中输入当前密码和两次新密码。新密码须为 12–128 位可打印 ASCII 字符，不含空格，且不能与当前密码相同。修改成功后所有设备会话失效，需重新登录。</p>
      <h3>临时密码与会话</h3>
      <p>临时密码到期后请联系有权管理账号的人员重新生成。首次使用临时密码时只能改密或退出；会话最长 8 小时，连续空闲 30 分钟后失效。</p>
      <h3>操作结果确认</h3>
      <p>费用、风险、错误及必需操作说明请以业务页面的实时提示为准；结果未确认时先核对状态，避免重复操作。</p>
      <el-button
        native-type="button"
        class="help-link"
        @click="emit('navigate', '/account/settings')"
      >进入账号设置<span aria-hidden="true"> →</span></el-button>
    </section>
  </section>
</template>

<style scoped>
.role-help {
  width: 100%;
  max-width: 1200px;
  margin-inline: auto;
  container-type: inline-size;
}
.help-heading { margin-bottom: 24px; }
.help-heading h1 { margin: 0; color: var(--console-text); font-size: 24px; font-weight: 600; line-height: 1.4; }
.help-heading p { margin: 8px 0 0; color: #596780; font-size: 14px; line-height: 1.7; }
.help-guides { display: grid; grid-template-columns: minmax(0, 1fr); gap: 24px; }
.help-section { min-width: 0; padding: 24px; border: 1px solid var(--console-line); border-radius: 8px; background: var(--console-surface); }
.help-section h2 { margin: 0 0 12px; color: var(--console-text); font-size: 18px; font-weight: 600; line-height: 1.5; }
.help-section p { max-width: 68em; margin: 0 0 20px; color: #4f5d73; font-size: 15px; line-height: 1.7; overflow-wrap: anywhere; }
.help-guide { display: flex; flex-direction: column; align-items: flex-start; }
.help-faq { margin-top: 24px; }
.help-faq h3 { margin: 20px 0 8px; color: var(--console-text); font-size: 15px; font-weight: 600; line-height: 1.5; }
@container (min-width: 960px) {
  .help-guides { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .help-guide:last-child:nth-child(odd) { grid-column: 1 / -1; }
}
@container (max-width: 479px) {
  .help-heading { margin-bottom: 20px; }
  .help-guides { gap: 16px; }
  .help-section { padding: 20px 16px; }
  .help-faq { margin-top: 16px; }
}
</style>
