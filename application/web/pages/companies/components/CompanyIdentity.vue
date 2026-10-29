<template>
  <div class="company-identity">
    <strong>{{ name }}</strong>
    <span class="identity-country">
      <img v-if="countryInfo" :src="countryInfo.flag" alt="" />
      {{ countryInfo ? `${countryInfo.name} ${country}` : country }}
    </span>
    <details>
      <summary>来源信息</summary>
      <small>来源标识 {{ sourceId }}</small>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { countries } from '../countries';

const props = defineProps<{ name: string; country: string; sourceId: string }>();
const countryInfo = computed(() => countries.find(country =>
  country.code === props.country
));
</script>

<style scoped>
.company-identity { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.company-identity strong { display: block; color: #28334b; font-size: 14px; font-weight: 600; line-height: 1.7; }
.identity-country { display: flex; align-items: center; gap: 8px; margin-top: 6px; color: #647087; font-size: 12px; }
.identity-country img { width: 20px; height: 15px; object-fit: cover; border-radius: 2px; }
details { margin-top: 6px; color: #647087; font-size: 12px; }
summary { width: fit-content; cursor: pointer; }
summary:focus-visible { outline: 2px solid #4356e0; outline-offset: 3px; }
small { display: block; margin-top: 4px; overflow-wrap: anywhere; }
</style>
