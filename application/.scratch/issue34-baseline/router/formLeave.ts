import {
  inject,
  onActivated,
  onDeactivated,
  onScopeDispose,
  provide,
  shallowRef,
  type InjectionKey
} from 'vue';
import type { RouteLocationNormalized, Router } from 'vue-router';

export type FormLeaveState = 'clean' | 'dirty' | 'submitting' | 'unknown';
export interface FormLeaveOptions {
  state: () => FormLeaveState;
  discard: () => void;
  active?: () => boolean;
  message?: string;
  /** Only allow unknown results to leave when their context survives navigation. */
  retainUnknown?: boolean;
}
interface Registration extends FormLeaveOptions {
  active: () => boolean;
}
const formLeaveKey: InjectionKey<(entry: Registration) => () => void> = Symbol('formLeave');

export function provideFormLeave(router: Router, enabled: () => boolean) {
  const entries = new Set<Registration>();
  const approvals = new WeakMap<RouteLocationNormalized, () => void>();
  function register(entry: Registration) {
    entries.add(entry);
    return () => entries.delete(entry);
  }
  function relevant(includeBackground: boolean) {
    return [...entries].filter(entry =>
      entry.active() || (includeBackground && ['submitting', 'unknown'].includes(entry.state()))
    );
  }
  function prepareLeave(includeBackground = true): (() => void) | undefined {
    if (!enabled()) return () => {};
    const current = relevant(includeBackground);
    if (current.some(entry =>
      entry.state() === 'submitting'
    )) return undefined;
    const dirty = current.filter(entry =>
      entry.state() === 'dirty'
    );
    const unknown = current.filter(entry =>
      entry.state() === 'unknown'
    );
    if (unknown.some(entry =>
      !entry.retainUnknown
    )) return undefined;
    if (unknown.length && !window.confirm('请求结果尚未确认。离开不会取消或重试请求，请返回后核实结果。确定离开吗？')) return undefined;
    if (dirty.length && !window.confirm(dirty[0].message ?? '您有未提交的修改。确定放弃并离开吗？取消将继续编辑。')) return undefined;
    return () => {
      for (const entry of dirty) {
        if (entry.state() === 'dirty') entry.discard();
      }
    };
  }
  const removeBefore = router.beforeResolve((to, from) => {
    if (to.fullPath === from.fullPath) return true;
    const commit = prepareLeave(false);
    if (!commit) return false;
    approvals.set(to, commit);
    return true;
  });
  const removeAfter = router.afterEach((to, _from, failure) => {
    const commit = approvals.get(to);
    approvals.delete(to);
    if (!failure) commit?.();
  });
  function beforeUnload(event: BeforeUnloadEvent) {
    if (enabled() && relevant(true).some(entry =>
      entry.state() !== 'clean'
    )) {
      event.preventDefault();
      event.returnValue = '';
    }
  }
  provide(formLeaveKey, register);
  window.addEventListener('beforeunload', beforeUnload);
  onScopeDispose(() => {
    removeBefore();
    removeAfter();
    window.removeEventListener('beforeunload', beforeUnload);
    entries.clear();
  });
  return { register, prepareLeave };
}

export function useFormLeave(options: FormLeaveOptions) {
  const register = inject(formLeaveKey);
  if (!register) throw new Error('useFormLeave requires the console form leave provider');
  const active = shallowRef(true);
  const unregister = register({
    ...options,
    active: () => active.value && (options.active?.() ?? true)
  });
  onActivated(() => { active.value = true; });
  onDeactivated(() => { active.value = false; });
  onScopeDispose(unregister);
}
