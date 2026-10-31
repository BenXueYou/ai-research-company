export interface Walkthrough {
  image: string;
  caption: string;
  steps: string[];
}

function walkthrough(image: string, caption: string, steps: string[]): Walkthrough {
  return { image: `/help/screenshots/${image}.png`, caption, steps };
}

export const walkthroughs: Record<string, Walkthrough> = {
  '/platform/organizations': walkthrough('platform-organizations', '下级管理 · 开户表单', [
    '进入下级管理，选择“开户”。',
    '填写组织名称、类型、联系号码和管理员邮箱，核对后确认开户。',
    '成功后在关闭凭据前安全交付临时密码，提醒管理员首次登录改密。'
  ]),
  '/distribution/organizations': walkthrough('distribution-organizations', '下级管理 · 直属开户', [
    '进入下级管理，选择“开户”。',
    '按页面允许的类型选择直属组织，填写联系信息和管理员邮箱。',
    '核对后确认开户，并安全交付当次显示的临时凭据。'
  ]),
  '/platform/ledger': walkthrough('platform-orders', '点数与账务 · 直属点数订单', [
    '选择直属下级，填写点数数量与单价，核对金额后建单。',
    '按订单状态登记足额线下收款，再处理预留和完整划拨。',
    '遇到库存不足或结果待确认，先核对订单状态，再按页面提示处理。'
  ]),
  '/platform/organizations?view=accounts': walkthrough('platform-accounts', '下级管理 · 下级账户查看', [
    '开户完成后进入“下级管理”，选择“下级账户”，点击“刷新账户”查看授权范围内企业的余额、查询冻结、销售预留和可用点数。',
    '此页面仅用于查看账户状态，不能直接输入余额或激活点数；下级企业点数必须通过点数订单完成收款确认和完整划拨。',
    '若显示“暂无点数账户数据”，先到“点数与账务”检查订单是否已完成完整划拨，再返回本页刷新。'
  ]),
  '/distribution/orders': walkthrough('distribution-orders', '点数订单 · 建单与处理入口', [
    '选择直属下级，填写点数数量和单价，核对后建单。',
    '收到足额款项后登记收款依据，按订单状态处理预留和划拨。',
    '退款与异常处理按订单现场提示操作；结果未确认时先核实状态。'
  ]),
  '/platform/ledger/procurement': walkthrough('procurement', '采购与费用 · 采购入账', [
    '选择采购用途，填写上游点数、采购人民币金额、采购凭证编号和核对依据。',
    '核对用途与关联费用是否一致，再确认采购入账。',
    '在记录区核对采购与费用；补足上游额度不生成新的内部点数。'
  ]),
  '/platform/settings': walkthrough('pricing', '平台设置 · 计价配置', [
    '在计价配置中找到需要调整的接口单价或最低加价率。',
    '填写变更内容与依据，核对后提交。',
    '点数换算系数在对应区域维护，提交前核对生效条件和覆盖范围。'
  ]),
  '/platform/reconciliation': walkthrough('reconciliation', '上游与对账 · 查询核对入口', [
    '点击“刷新查询”，查看需要人工核对的查询记录。',
    '选择记录，依据供应商账单与查询证据填写核对结论。',
    '核对扣点和相关费用后再提交；上游快照通过页面入口单独查看。'
  ]),
  '/distribution/profit': walkthrough('profit', '交易与利润 · 查看范围与汇总', [
    '先确认当前查看范围，再阅读交易与利润汇总。',
    '结合账户、交易和用量明细核对数据。',
    '查看多层下级数据不赋予跨级开户、交易、定价或密码重置权限。'
  ]),
  '/terminal/search': walkthrough('search', '找企业 · 公司名称查询', [
    '输入公司名称并选择国家，点击“免费查询”。',
    '核对候选企业身份，确认是目标企业后再继续。',
    '查询详情前查看报价，并在操作页面确认费用；免费搜索不等于详情免费。'
  ]),
  '/terminal/emails': walkthrough('emails', '邮件发送记录 · 发送结果查询', [
    '在企业业务中核对联系人、收件地址与邮件内容，按提示确认额度和发送。',
    '进入邮件发送记录，查看本企业已生成的发送批次与状态。',
    '需要时进入记录查看详情；受理不等于送达，结果不明确时先核对再决定重发。'
  ]),
  '/terminal/members': walkthrough('members', '成员管理 · 新增团队成员', [
    '填写成员姓名、登录邮箱，并选择成员角色。',
    '核对后创建成员，安全交付当次显示的临时凭据。',
    '维护成员时按页面权限操作，本人和首位管理员不可停用。'
  ]),
  permissions: walkthrough('sales-permissions', '团队发信设置 · 业务员查看页面', [
    '业务员按授权查看团队渠道配置与验证结果。',
    '需要调整发信设置或成员时，联系本企业管理员。'
  ]),
  account: walkthrough('account', '账号设置 · 修改本人密码', [
    '进入账号设置，填写当前密码和两次新密码。',
    '核对密码要求后确认修改，成功后使用新密码重新登录。'
  ])
};
