import 'reflect-metadata';
import {
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Module,
  Post,
  Req,
  Res,
  type CanActivate,
  type ExecutionContext
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, { type Request, type Response } from 'express';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import type pg from 'pg';
import { digest, IdentityService, type Identity } from './identity.js';

interface AuthRequest extends Request { identity: Identity; sessionToken: string }
function cookie(request: Request, name: string): string {
  const pair = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
  return pair?.slice(name.length + 1) ?? '';
}
class IdentityGuard implements CanActivate {
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
export async function createApplication(pool: pg.Pool, origin: string, production = false) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (production && parsed.protocol !== 'https:'))
    throw new Error('APP_ORIGIN 必须是精确源；生产环境要求 HTTPS');
  const service = new IdentityService(pool);
  const cookieOptions = { secure: production, sameSite: 'strict' as const, path: '/', maxAge: 8 * 60 * 60 * 1000 };
  @Controller('api')
  class IdentityController {
    @Post('auth/login')
    @HttpCode(200)
    async login(@Req() request: Request, @Res() response: Response) {
      const result = await service.login(request.body ?? {}, request.ip ?? 'unknown');
      response.cookie('identity_session', result.token, { ...cookieOptions, httpOnly: true });
      response.cookie('identity_csrf', result.csrf, { ...cookieOptions, httpOnly: false });
      response.json({ ok: true });
    }
    @Get('auth/session')
    session(@Req() request: AuthRequest) {
      const { id, email, role, organization_id, must_change } = request.identity;
      return { id, email, role, organizationId: organization_id, mustChange: must_change };
    }
    @Post('auth/password')
    @HttpCode(200)
    async password(@Req() request: AuthRequest, @Res() response: Response) {
      await service.changePassword(request.sessionToken, request.body ?? {});
      response.clearCookie('identity_session', cookieOptions);
      response.clearCookie('identity_csrf', cookieOptions);
      response.json({ ok: true });
    }
    @Post('auth/logout')
    @HttpCode(200)
    async logout(@Req() request: AuthRequest, @Res() response: Response) {
      await service.logout(request.sessionToken);
      response.clearCookie('identity_session', cookieOptions);
      response.clearCookie('identity_csrf', cookieOptions);
      response.json({ ok: true });
    }
    @Get('workspace')
    workspace(@Req() request: AuthRequest) {
      return { title: '工作台', email: request.identity.email, message: '身份验证已完成。后续业务模块尚未开放。' };
    }
  }
  @Module({ controllers: [IdentityController] })
  class ApplicationModule {}
  const app = await NestFactory.create(ApplicationModule, { logger: false, bodyParser: false });
  app.use((request: Request, response: Response, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.path.startsWith('/api')) response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '8kb', strict: true }));
  app.useGlobalGuards(new IdentityGuard(service, origin));
  app.use(express.static(resolve('dist/web'), { index: 'index.html' }));
  // No SPA fallback for /api: unknown endpoints never become publicly accessible business routes.
  app.enableShutdownHooks();
  return app;
}
