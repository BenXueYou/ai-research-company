var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, HttpCode, Req, Res } from '@nestjs/common';
export function createIdentityController(services, cookieOptions) {
    const { service, members, passwordResets } = services;
    let IdentityController = class IdentityController {
        async login(request, response) {
            const result = await service.login(request.body ?? {}, request.ip ?? 'unknown');
            response.cookie('identity_session', result.token, { ...cookieOptions, httpOnly: true });
            response.cookie('identity_csrf', result.csrf, { ...cookieOptions, httpOnly: false });
            response.json({ ok: true });
        }
        session(request) {
            const { id, email, username, role, organization_id, must_change } = request.identity;
            return { id, email, loginName: username ?? email, role, organizationId: organization_id, mustChange: must_change };
        }
        async password(request, response) {
            await service.changePassword(request.sessionToken, request.body ?? {});
            response.clearCookie('identity_session', cookieOptions);
            response.clearCookie('identity_csrf', cookieOptions);
            response.json({ ok: true });
        }
        async logout(request, response) {
            await service.logout(request.sessionToken);
            response.clearCookie('identity_session', cookieOptions);
            response.clearCookie('identity_csrf', cookieOptions);
            response.json({ ok: true });
        }
        workspace(request) {
            return { title: '工作台', email: request.identity.email, message: '身份验证已完成。后续业务模块尚未开放。' };
        }
        members(request) {
            return members.list(request.identity, request.sessionToken);
        }
        createMember(request) {
            return members.create(request.identity, request.sessionToken, request.body ?? {});
        }
        disableMember(request) {
            return members.disable(request.identity, request.sessionToken, request.body ?? {});
        }
        resetPassword(request) {
            return passwordResets.reset(request.identity, request.sessionToken, request.body ?? {});
        }
    };
    __decorate([
        Post('auth/login'),
        HttpCode(200),
        __param(0, Req()),
        __param(1, Res())
    ], IdentityController.prototype, "login", null);
    __decorate([
        Get('auth/session'),
        __param(0, Req())
    ], IdentityController.prototype, "session", null);
    __decorate([
        Post('auth/password'),
        HttpCode(200),
        __param(0, Req()),
        __param(1, Res())
    ], IdentityController.prototype, "password", null);
    __decorate([
        Post('auth/logout'),
        HttpCode(200),
        __param(0, Req()),
        __param(1, Res())
    ], IdentityController.prototype, "logout", null);
    __decorate([
        Get('workspace'),
        __param(0, Req())
    ], IdentityController.prototype, "workspace", null);
    __decorate([
        Get('members'),
        __param(0, Req())
    ], IdentityController.prototype, "members", null);
    __decorate([
        Post('members'),
        __param(0, Req())
    ], IdentityController.prototype, "createMember", null);
    __decorate([
        Post('members/disable'),
        __param(0, Req())
    ], IdentityController.prototype, "disableMember", null);
    __decorate([
        Post('password-resets'),
        __param(0, Req())
    ], IdentityController.prototype, "resetPassword", null);
    IdentityController = __decorate([
        Controller('api')
    ], IdentityController);
    return IdentityController;
}
//# sourceMappingURL=controller.js.map