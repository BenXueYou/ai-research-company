import { ref, type Ref } from 'vue';
import { useRouter } from 'vue-router';
import { defaultPath } from '../../router';
import { useSessionStore } from '../../stores/session';

export function useLogin(
  run: (action: () => Promise<void>) => Promise<void>,
  navigatingAfterLogin: Ref<boolean>
) {
  const auth = useSessionStore();
  const router = useRouter();
  const email = ref('');
  const loginPassword = ref('');

  async function login() {
    await run(async () => {
      try {
        await auth.login(email.value, loginPassword.value);
        if (auth.session && !auth.session.mustChange) {
          navigatingAfterLogin.value = true;
          try {
            await router.replace(defaultPath(auth.session.role));
          } finally {
            navigatingAfterLogin.value = false;
          }
        }
      } finally {
        loginPassword.value = '';
      }
    });
  }

  return { email, loginPassword, login };
}
