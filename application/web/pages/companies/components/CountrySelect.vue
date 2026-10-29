<template>
  <el-select
    :id="id"
    v-model="selectedCodes"
    class="country-select"
    :multiple="multiple"
    filterable
    :allow-create="canCreate"
    :reserve-keyword="false"
    default-first-option
    :disabled="disabled"
    :filter-method="filterCountries"
    :placeholder="multiple ? '搜索国家名称或三位编码，可多选' : '搜索并选择国家/地区'"
    no-match-text="没有匹配的国家/地区"
    @visible-change="resetFilter"
  >
    <el-option
      v-for="country in filteredCountries"
      :key="country.code"
      :value="country.code"
      :label="`${country.name} ${country.code}`"
    >
      <span class="country-option">
        <img class="country-flag" :src="country.flag" alt="" />
        <span>{{ country.name }}</span>
        <span class="country-code">{{ country.code }}</span>
      </span>
    </el-option>
    <template #label="{ value, label }">
      <span class="country-option country-selection">
        <img v-if="countryByCode.get(value)?.flag" class="country-flag" :src="countryByCode.get(value)?.flag" alt="" />
        <span>{{ label }}</span>
      </span>
    </template>
  </el-select>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElOption, ElSelect } from 'element-plus';
import { countries } from '../countries';

const props = withDefaults(defineProps<{ id: string; disabled: boolean; multiple?: boolean }>(), {
  multiple: true
});
const model = defineModel<string>({ required: true });
const query = ref('');
const countryByCode = new Map(countries.map(country =>
  [country.code, country]
));
const selectedCodes = computed({
  get: () => props.multiple ? (model.value ? model.value.split(',') : []) : model.value,
  set: (codes: string[] | string) => { model.value = Array.isArray(codes) ? codes.join(',') : codes; }
});
const filteredCountries = computed(() => countries.filter(country =>
  `${country.name} ${country.englishName} ${country.code}`.toLowerCase().includes(query.value)
));
const canCreate = computed(() => /^[a-z]{1,3}$/.test(query.value) && !countryByCode.has(query.value.toUpperCase()));
function filterCountries(value: string) {
  query.value = value.trim().toLowerCase();
}
function resetFilter(visible: boolean) {
  if (!visible) query.value = '';
}
</script>

<style scoped>
.country-option { display: flex; align-items: center; gap: 9px; }
.country-selection { min-width: 0; }
.country-selection > span { overflow: hidden; text-overflow: ellipsis; }
.country-flag { width: 20px; height: 15px; flex-shrink: 0; object-fit: cover; border-radius: 2px; box-shadow: 0 0 0 1px #00000012; }
.country-code { margin-left: auto; padding-left: 16px; color: #8490a5; font-size: 12px; }
</style>
