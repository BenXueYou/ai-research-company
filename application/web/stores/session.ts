import { defineStore } from 'pinia';
import { shallowRef } from 'vue';

export interface Session {
  id: string;
  email: string | null;
  loginName: string;
  role: string;
  mustChange: boolean;
}

export type SessionStatus = 'idle' | 'loading' | 'authenticated' | 'anonymous' | 'error';

export const useSessionStore = defineStore('session', () => {
  const session = shallowRef<Session | null>(null);
  const status = shallowRef<SessionStatus>('idle');
  const loadError = shallowRef('');
  const generation = shallowRef(0);
  let pending: Promise<void> | null = null;

  function clear() {
    generation.value += 1;
    session.value = null;
    status.value = 'anonymous';
    loadError.value = '';
    pending = null;
  }

  async function request(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const issuedIn = generation.value;
    const csrf = document.cookie.split('; ').find(item =>
      item.startsWith('identity_csrf=')
    )?.slice(14) ?? '';
    const response = await fetch(`/api/${path}`, {
      method: body ? 'POST' : 'GET',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf } : {},
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json();
    if (issuedIn !== generation.value) throw new Error('会话已变化，请重新登录');
    if (!response.ok) {
      if (response.status === 401 && path !== 'auth/login') clear();
      throw new Error(typeof data.message === 'string' ? data.message : '请求失败，请稍后重试');
    }
    return data;
  }

  function initialize(force = false): Promise<void> {
    if (pending) return pending;
    if (!force && status.value !== 'idle' && status.value !== 'error') return Promise.resolve();
    const issuedIn = generation.value;
    status.value = 'loading';
    loadError.value = '';
    const current = (async () => {
      try {
        const loaded = await request('auth/session') as Session;
        if (issuedIn !== generation.value) return;
        session.value = loaded;
        status.value = 'authenticated';
      } catch (failure) {
        if (issuedIn !== generation.value) return;
        if (status.value === 'anonymous') return;
        status.value = 'error';
        loadError.value = failure instanceof Error ? failure.message : '加载失败';
      }
    })();
    pending = current;
    void current.finally(() => {
      if (pending === current) pending = null;
    });
    return current;
  }

  async function login(email: string, password: string) {
    await request('auth/login', { email, password });
    clear();
    await initialize(true);
    if (status.value !== 'authenticated') throw new Error(loadError.value || '会话读取失败，请重试');
  }

  return { session, status, loadError, generation, clear, request, initialize, login };
});
