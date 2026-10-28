import { ForbiddenException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';
import { digest, type Identity, IdentityService } from './identity.js';

export interface AuthRequest extends Request { identity: Identity; sessionToken: string }
function cookie(request: Request, name: string): string {
  const pair = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) ?? '';
}
export class IdentityGuard implements CanActivate {
  constructor(private readonly service: IdentityService, private readonly origin: string) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    if (mutation && (request.headers.origin !== this.origin || !request.is('application/json')))
      throw new ForbiddenException('请求来源或内容类型无效');
    if (request.method === 'POST' && request.path === '/api/auth/login')
      return true;
    request.sessionToken = cookie(request, 'identity_session');
    request.identity = await this.service.authenticate(request.sessionToken);
    if (mutation) {
      const csrf = request.headers['x-csrf-token'];
      const expected = Buffer.from(request.identity.csrf_hash, 'hex');
      const actual = Buffer.from(digest(typeof csrf === 'string' ? csrf : ''), 'hex');
      if (!timingSafeEqual(expected, actual))
        throw new ForbiddenException('安全校验失败，请刷新后重试');
    }
    if (request.identity.must_change && !['/api/auth/session', '/api/auth/password', '/api/auth/logout'].includes(request.path))
      throw new ForbiddenException('必须先修改密码');
    return true;
  }
}
