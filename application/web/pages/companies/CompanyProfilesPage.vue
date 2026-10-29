<template>
  <section class="company-profiles" aria-label="企业档案库">
    <header class="profiles-heading">
      <div>
        <p class="profiles-eyebrow">客户管理 / 团队共享</p>
        <h1>本企业档案库</h1>
        <p class="hint">查看团队已保存的企业信息，维护客户状态和跟进记录。</p>
      </div>
      <span class="profiles-count">当前列表 <strong>{{ profiles.length }}</strong> 家企业</span>
    </header>
    <form class="profiles-filters" @submit.prevent="load">
      <label>客户状态 <el-select :empty-values="[null, undefined]" v-model="statusFilter">
        <el-option value="" label="全部" /><el-option value="lead" label="线索" /><el-option value="following" label="跟进中" />
        <el-option value="replied" label="已回复" /><el-option value="invalid" label="无效" />
      </el-select></label>
      <label>跟进开始 <el-date-picker v-model="followUpFrom" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" /></label>
      <label>跟进结束 <el-date-picker v-model="followUpTo" type="date" value-format="YYYY-MM-DD" format="YYYY-MM-DD" :clearable="false" /></label>
      <label v-if="auth.session?.role === 'admin'" class="deleted-filter"><input v-model="showDeleted" type="checkbox" />查看已删除</label>
      <button class="filter-primary" type="submit" :disabled="loading">筛选档案</button>
      <button type="button" :disabled="loading" @click="load">刷新列表</button>
    </form>
    <p v-if="loading" role="status">正在读取档案…</p>
    <p v-else-if="error" role="alert">{{ error }}</p>
    <div v-else-if="!profiles.length" class="profiles-empty" role="status">
      <el-empty :image-size="112" description="当前筛选下没有档案">
        <template #description>
          <h2>{{ hasAppliedFilters ? '未找到匹配档案' : '暂无企业档案' }}</h2>
          <p>当前筛选下没有档案</p>
          <p class="profiles-empty-hint">{{ hasAppliedFilters ? '请调整上方客户状态、跟进日期或已删除选项后，重新筛选。' : '前往找企业，查询并保存企业信息后，即可在这里查看和跟进。' }}</p>
        </template>
        <RouterLink v-if="!hasAppliedFilters" class="profiles-empty-action" to="/terminal/search">去找企业 <span aria-hidden="true">→</span></RouterLink>
      </el-empty>
    </div>
    <div class="profiles-content">
    <ul v-if="!error && profiles.length" class="profiles-list" aria-label="企业档案列表">
      <li v-for="profile in profiles" :key="profile.id" :class="{ 'is-selected': selectedId === profile.id }">
        <RouterLink :to="{ path: '/terminal/profiles', query: { id: profile.id } }">{{ profile.name }} · {{ profile.countryCode3 }}</RouterLink>
        <div class="profile-list-meta">
          <span class="profile-status" :data-status="profile.customerStatus">{{ statusLabels[profile.customerStatus] }}</span>
          <span class="profile-rating">星级 {{ profile.starRating ?? '未设置' }}</span>
        </div>
      </li>
    </ul>
    <p v-if="!loading && !error && selectedId && !selected" role="alert">当前筛选下找不到本企业档案，请核对档案链接或调整筛选。</p>
    <CompanyProfileDetail
      v-for="profile in visited"
      v-show="!error && selected?.id === profile.id"
      :key="profile.id"
      :profile="profile"
      :visible="!error && selected?.id === profile.id"
      :current-account-id="auth.session!.id"
      :can-delete="auth.session?.role === 'admin'"
      :request="request"
      @changed="load"
    />
    <div v-if="!selectedId && !error && profiles.length" class="profile-placeholder">
      <span aria-hidden="true">▤</span>
      <h2>选择企业档案</h2>
      <p>从列表选择企业，查看详情、联系人与跟进记录。</p>
    </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ElDatePicker, ElOption, ElSelect } from 'element-plus';
import { computed, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { useSessionStore } from '../../stores/session';
import { listCompanyProfiles, type CompanyProfile, type CompanyRequest } from '../../api/companyProfiles';
import CompanyProfileDetail from './components/CompanyProfileDetail.vue';

defineOptions({ name: 'CompanyProfilesPage' });
const props = defineProps<{ request: CompanyRequest }>();
const auth = useSessionStore();
const route = useRoute();
const profiles = ref<CompanyProfile[]>([]);
const visited = ref<CompanyProfile[]>([]);
const loading = ref(false);
const error = ref('');
const statusFilter = ref('');
const followUpFrom = ref('');
const followUpTo = ref('');
const showDeleted = ref(false);
const hasAppliedFilters = ref(false);
const statusLabels: Record<string, string> = {
  lead: '线索',
  following: '跟进中',
  replied: '已回复',
  invalid: '无效'
};
const selectedId = computed(() => typeof route.query.id === 'string' ? route.query.id : '');
const selected = computed(() => profiles.value.find(profile =>
  profile.id === selectedId.value
));
watch(selected, profile => {
  if (!profile) return;
  const index = visited.value.findIndex(item =>
    item.id === profile.id
  );
  if (index < 0) visited.value.push(profile);
  else visited.value[index] = profile;
});
async function load() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  const filters: Record<string, unknown> = { deleted: showDeleted.value };
  if (statusFilter.value) filters.customerStatus = statusFilter.value;
  if (followUpFrom.value) filters.followUpFrom = followUpFrom.value;
  if (followUpTo.value) filters.followUpTo = followUpTo.value;
  try {
    profiles.value = await listCompanyProfiles(props.request, filters);
    hasAppliedFilters.value = Boolean(filters.customerStatus || filters.followUpFrom || filters.followUpTo || filters.deleted);
  } catch (failure) {
    error.value = failure instanceof Error ? failure.message : '档案读取失败，请重试';
  } finally {
    loading.value = false;
  }
}
watch(selectedId, id => {
  if (route.path !== '/terminal/profiles' || !id || profiles.value.some(profile =>
    profile.id === id
  )) return;
  void load();
});
void load();
</script>

<style scoped>
.company-profiles { --profile-line: #e6e9f0; --profile-muted: #738095; min-width: 0; color: #1c2333; font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", sans-serif; }
.profiles-heading { display: flex; justify-content: space-between; align-items: center; gap: 20px; margin-bottom: 24px; }
.profiles-heading h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.4; letter-spacing: -.4px; }
.profiles-heading .hint { margin: 0; font-size: 13px; }
.profiles-eyebrow { margin: 0 0 8px; color: #4356e0; font-size: 11px; font-weight: 600; letter-spacing: 1px; }
.profiles-count { flex-shrink: 0; color: var(--profile-muted); font-size: 12px; }
.profiles-count strong { margin: 0 5px; color: #4356e0; font-size: 22px; font-variant-numeric: tabular-nums; }
.profiles-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 16px; padding: 20px; margin-bottom: 24px; border: 1px solid var(--profile-line); border-radius: 12px; background: #fff; }
.profiles-filters label { display: grid; gap: 7px; color: #647087; font-size: 12px; }
.profiles-filters input[type="checkbox"] { min-width: 0; min-height: 38px; padding: 8px 11px; border: 1px solid #dfe4ee; border-radius: 8px; background: #fff; color: #263052; font: inherit; }
.profiles-filters .deleted-filter { display: flex; align-items: center; align-self: center; gap: 7px; padding-top: 20px; }
.deleted-filter input { min-height: auto; margin: 0; accent-color: #4356e0; }
.profiles-filters button { min-height: 38px; padding: 8px 15px; border: 1px solid #dfe4ee; border-radius: 8px; background: #fff; color: #465064; font: inherit; font-size: 12px; cursor: pointer; }
.profiles-filters .filter-primary { border-color: #4356e0; background: #4356e0; color: #fff; }
.profiles-filters button:hover { border-color: #b5bff6; background: #f4f6ff; color: #4356e0; }
.profiles-filters .filter-primary:hover { background: #3343c9; color: #fff; }
.profiles-filters button:disabled { opacity: .5; cursor: not-allowed; }
.profiles-filters input:focus-visible { outline: 2px solid #b5bff6; outline-offset: 2px; }
.profiles-content { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 20px; align-items: start; }
.profiles-empty { padding: 32px 20px; border: 1px solid var(--profile-line); border-radius: 12px; background: #fff; text-align: center; }
.profiles-empty h2 { margin: 0 0 12px; color: #263052; font-size: 18px; font-weight: 600; }
.profiles-empty p { margin: 0; color: var(--profile-muted); font-size: 13px; line-height: 1.8; }
.profiles-empty .profiles-empty-hint { max-width: 460px; margin: 8px auto 0; }
.profiles-empty-action { display: inline-flex; align-items: center; gap: 12px; padding: 10px 20px; border-radius: 8px; background: #4356e0; color: #fff; font-size: 13px; text-decoration: none; }
.profiles-empty-action:hover { background: #3343c9; }
.profiles-empty-action:focus-visible { outline: 2px solid #b5bff6; outline-offset: 3px; }
.profiles-list { grid-column: 1; grid-row: 1 / span 2; margin: 0; padding: 8px; border: 1px solid var(--profile-line); border-radius: 12px; background: #fff; list-style: none; }
.profiles-list li { position: relative; padding: 16px 12px; border: 1px solid transparent; border-radius: 8px; }
.profiles-list li + li { margin-top: 4px; }
.profiles-list li:hover { background: #f8f9fd; }
.profiles-list .is-selected { border-color: #dce1fc; background: #eff2ff; }
.profiles-list a { display: block; color: #263052; font-size: 13px; font-weight: 600; line-height: 1.6; text-decoration: none; overflow-wrap: anywhere; }
.profiles-list a::after { position: absolute; inset: 0; content: ''; border-radius: 8px; }
.profiles-list .is-selected a { color: #4356e0; }
.profile-list-meta { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 12px; font-size: 11px; }
.profile-status { padding: 3px 8px; border-radius: 5px; background: #eef1f7; color: #66748e; }
.profile-status[data-status="following"] { background: #e9edff; color: #4356e0; }
.profile-status[data-status="replied"] { background: #e5f5ee; color: #16885e; }
.profile-status[data-status="invalid"] { background: #fff0f0; color: #b24747; }
.profile-rating { color: #8b754d; }
.profiles-content > :deep(.profile-detail), .profile-placeholder { grid-column: 2; grid-row: 1; min-width: 0; }
.profile-placeholder { padding: 72px 28px; border: 1px dashed #dce1ee; border-radius: 12px; background: #ffffff80; text-align: center; }
.profile-placeholder > span { display: inline-grid; width: 48px; height: 48px; place-items: center; border-radius: 12px; background: #e9edff; color: #4356e0; font-size: 26px; }
.profile-placeholder h2 { margin: 18px 0 8px; font-size: 16px; }
.profile-placeholder p { margin: 0; font-size: 13px; }
.company-profiles > p[role] { padding: 16px 20px; border: 1px solid var(--profile-line); border-radius: 8px; background: #fff; font-size: 13px; }
.profiles-content > p[role="alert"] { grid-column: 2; padding: 20px; border-radius: 10px; background: #fff5f0; color: #a65f32; }
@media (max-width: 1100px) {
  .profiles-content { grid-template-columns: 210px minmax(0, 1fr); gap: 16px; }
}
@media (max-width: 800px) {
  .profiles-heading { align-items: flex-start; flex-direction: column; gap: 8px; }
  .profiles-count strong { font-size: 18px; }
  .profiles-filters { gap: 12px; padding: 16px; }
  .profiles-filters label { flex: 1 1 140px; }
  .profiles-filters .deleted-filter { flex-basis: 100%; padding-top: 0; }
  .profiles-content { display: flex; flex-direction: column; }
  .profiles-list, .profile-placeholder, .profiles-content > :deep(.profile-detail) { width: 100%; }
  .profiles-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); }
  .profiles-list li + li { margin-top: 0; }
}

/* Element Plus 下拉框沿用页面控件尺寸，状态样式由组件提供。 */
:deep(.el-select) { min-width: 0; }
.profiles-filters :deep(.el-select) { width: 128px; }
.profiles-filters :deep(.el-select__wrapper) { min-height: 38px; border-radius: 8px; }
.el-date-editor.el-input { width: 100%; min-width: 0; }
.profiles-filters :deep(.el-date-editor) { width: 160px; }
.profiles-filters :deep(.el-date-editor .el-input__wrapper) { min-height: 38px; border-radius: 8px; }
</style>
