<script setup lang="ts">
import { onBeforeRouteLeave, onBeforeRouteUpdate } from 'vue-router';

const props = defineProps<{ confirmLeave: () => boolean }>();
onBeforeRouteLeave(() => props.confirmLeave());
onBeforeRouteUpdate(() => props.confirmLeave());
</script>

<template><span hidden></span></template>
