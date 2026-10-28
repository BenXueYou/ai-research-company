import {
  computed,
  onScopeDispose,
  ref,
  shallowRef
} from 'vue';
import { useFormLeave } from '../../../router/formLeave';
import { HttpError } from '../../../api/http';

// Context lives only in this session's cached page; never persist credentials.
export function useChannelForm(options: {
  values: () => Record<string, unknown>;
  restore: () => void;
  enabled: () => boolean;
}) {
  const baseline = ref('');
  let requestId = crypto.randomUUID();
  const busy = ref(false);
  const unknown = ref(false);
  const pending = shallowRef<Record<string, unknown> | null>(null);
  const locked = computed(() => busy.value || unknown.value);
  function clean() { baseline.value = JSON.stringify(options.values()); }
  function discard() {
    options.restore();
    pending.value = null;
    clean();
  }
  useFormLeave({
    state: () => {
      if (busy.value) return 'submitting';
      if (unknown.value) return 'unknown';
      return options.enabled() && JSON.stringify(options.values()) !== baseline.value ? 'dirty' : 'clean';
    },
    discard,
    retainUnknown: true
  });
  clean();
  onScopeDispose(() => {
    pending.value = null;
    baseline.value = '';
    options.restore();
  });
  function payload() {
    pending.value ??= { ...options.values(), requestId };
    return pending.value;
  }
  function succeeded() {
    unknown.value = false;
    requestId = crypto.randomUUID();
    pending.value = null;
    clean();
  }
  function failed(failure: unknown) {
    // Only a definite client rejection allows editing a new configuration.
    unknown.value = !(failure instanceof HttpError && failure.status < 500);
    if (!unknown.value) pending.value = null;
  }
  return {
    busy,
    unknown,
    locked,
    clean,
    payload,
    succeeded,
    failed
  };
}
