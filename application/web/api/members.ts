export interface Credentials { email: string; temporaryPassword: string; expiresAt: string }
export interface Member { id: string; name: string | null; email: string; role: string; active: boolean; canDisable: boolean }
export type MemberRequest = (path: string, body?: Record<string, string>) => Promise<unknown>;
export function membersApi(request: MemberRequest) {
  return {
    list: () => request('members') as Promise<{ members: Member[] }>,
    create: (body: Record<string, string>) => request('members', body) as Promise<Credentials>,
    reset: (body: Record<string, string>) => request('password-resets', body) as Promise<Credentials>,
    disable: (body: Record<string, string>) => request('members/disable', body)
  };
}
