import {
  inject,
  provide,
  shallowReactive,
  type InjectionKey
} from 'vue';

type TitleSource = () => string;
const titleKey: InjectionKey<{ source?: TitleSource }> = Symbol('breadcrumbTitle');

export function provideBreadcrumbTitle() {
  const state = shallowReactive<{ source?: TitleSource }>({});
  provide(titleKey, state);
}

export function useBreadcrumbTitle(source?: TitleSource) {
  const state = inject(titleKey);
  if (state && source) state.source = source;
  return () => state?.source?.() ?? '';
}
