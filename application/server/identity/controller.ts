import { Controller, Get, Post, HttpCode, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthRequest } from '../identity/guard.js';
import type { Services } from '../composition/services.js';

export function createIdentityController(services: Services, cookieOptions: { secure: boolean; sameSite: 'strict'; path: string; maxAge: number }) {
  const { service, members, passwordResets } = services;
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
      const { id, email, username, role, organization_id, must_change } = request.identity;
      return { id, email, loginName: username ?? email, role, organizationId: organization_id, mustChange: must_change };
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
    @Get('members')
    members(@Req() request: AuthRequest) {
      return members.list(request.identity, request.sessionToken);
    }
    @Post('members')
    createMember(@Req() request: AuthRequest) {
      return members.create(request.identity, request.sessionToken, request.body ?? {});
    }
    @Post('members/disable')
    disableMember(@Req() request: AuthRequest) {
      return members.disable(request.identity, request.sessionToken, request.body ?? {});
    }
    @Post('password-resets')
    resetPassword(@Req() request: AuthRequest) {
      return passwordResets.reset(request.identity, request.sessionToken, request.body ?? {});
    }
  }
  return IdentityController;
}
