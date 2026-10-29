# 找企业：市场探索、Tab 表单与独立结果区

## 设计与范围

根据用户确认的交互预览调整真实页面：页头下先展示市场探索，左文案右地球；下方以 Element Plus ElTabs / ElTabPane 切换产品词与公司名表单；搜索结果在表单下方独立展示。保留原主题 #4356e0、主题派生色、现有 SVG 插画和 Element Plus 默认控件外观。

TerminalSearchPage 移除重复的页标题与搜索方式下拉框，以市场区的 h1 提供页面标题，保留企业开发流程提示。CompanySearch / ProductSearch 各保留单一实例并用 v-show 切换，不由 Tab 卸载；各自负责筛选和结果区域，报价、核实、详情、未决提示、档案入口及点数信息仍在原组件内。表单字段容器与操作区布局集中在 forms.css；未穿透覆盖子控件尺寸、内部外观及交互状态。

宽容器产品表单四字段横排，日期保留默认 220px 宽度，容器宽度小于等于 600px 时整张表单改为单列；中间宽度两列。说明和按钮置于同一操作区，手机顺序换行。公司表单保留两字段。初始结果区域展示待查询说明，无演示企业、模拟统计或新增请求。

本轮开始时 AGENTS.md 和技术设计文档已有其他未提交改动，本轮不修改它们。修改两个搜索组件的模板及样式、页面、公共表单布局，并将既有 terminal.spec.ts 的两处原生搜索方式选择器改为 Tab 定位。

## 业务契约

已读取第一阶段 Spec 的“查询、标识与结算”及相关 API、组件脚本。两个搜索组件的 script setup 与本轮修改前备份逐字相同，业务请求取值、权限、默认值、锁、离开保护及提交条件不变。

| 链路 | 修改前后来源 | 受控浏览器实际最终参数 |
| --- | --- | --- |
| 公司名查询 | name、countryCodes、原 pageNo/pageSize | name=Sample Company，countryCodes=CHN，pageNo=1，pageSize=20 |
| 产品报价 | productDesc、buyerCountryCode3、startDate/endDate、原 pageNo/pageSize | productDesc=ceramic pump，buyerCountryCode3=TUR，startDate=2026-01-01，endDate=2026-06-30，pageNo=1，pageSize=20 |
| 产品执行 | 报价响应 pageId | pageId=page-57 |
| 产品候选核实 | 产品候选 candidateId | candidateId=product-candidate-34 |
| 公司候选确认 | 核实返回的 company candidateId | candidateId=candidate-73，与 sourceId=source-921 不同 |
| 详情报价 | 已确认候选 candidateId | candidateId=candidate-73；响应 queryId=detail-89 |

产品国家和日期默认空，公司国家默认 CHN。Tab 只控制显示，不作为业务参数，不触发请求。取消报价未产生 execute 调用；未决产品结果跨 Tab 保留锁，主动核实后恢复结果。未增加国家自动选择或日期预填，未将两个日期合并成新的范围模型。

## 验证

- application 内 npx --no-install vue-tsc --noEmit：通过。
- application 内 npx --no-install vite build --outDir .scratch/search-tabs-layout/web：通过，保留既有大包提示；未覆盖共享 dist。
- 受控 Chrome + Playwright 挂载实际 TerminalSearchPage、CompanySearch、ProductSearch 及全量现有样式：通过 1440、1140、1024、768、600、390、320px × 两种模式共 14 组布局检查，无页面横向溢出；市场区在表单上方，结果区在表单下方，输入/选择/日期 wrapper 高度保持 32px。
- 已查看桌面、768px 与手机布局截图；检查产品横排、中间两列、手机单列、主题与插画。此为真实组件隔离预览，不代表完整登录控制台验收。
- 受控交互验证通过：默认产品模式、公司初始 CHN、两模式输入和结果保留、报价跨 Tab 保留、切换不增加请求、报价取消无付费执行、未决锁和主动核实恢复、产品候选核实到详情报价、公司空结果及产品报价拒绝状态；无页面运行异常。不同标识字段及全部实际调用写入 evidence.json。
- 脚本及证据：application/.scratch/search-tabs-layout/{main.ts,verify.mjs,evidence.json}；截图包括 1440.png、768.png、390.png、320.png、results-mobile.png。
- git diff --check：通过。

未运行真实后端、PostgreSQL、权限/跨租户拒绝、账务冻结结算、真实供应商、详情付费建档、联系人或邮件端到端。模拟的“映射尚未核实”只验证错误呈现，不能证明服务端业务拒绝有效。既有真实 terminal 集成套件只更新入口定位，未运行该套件。未部署、重启服务、提交或推送。
