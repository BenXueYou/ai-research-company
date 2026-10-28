var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
import 'reflect-metadata';
import { Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { resolve } from 'node:path';
import { DeferredDomesticSmtpAdapter } from './email/smtp-channel.js';
import { DeferredUMailAdapter } from './email/umail.js';
import { IdentityGuard } from './identity/guard.js';
import { createServices } from './composition/services.js';
import { createIdentityController } from './identity/controller.js';
import { createOrganizationsController } from './organizations/controller.js';
import { createCommerceController } from './commerce/controller.js';
import { createCompaniesController } from './companies/controller.js';
import { createEmailController } from './email/controller.js';
import { createUpstreamController } from './upstream/controller.js';
const unavailableTengdao = {
    listCompanies: async () => { throw new ServiceUnavailableException('腾道企业查询尚未配置'); }
};
export async function createApplication(pool, origin, production = false, smtpAdapter = new DeferredDomesticSmtpAdapter(), tengdao = unavailableTengdao, umailAdapter = new DeferredUMailAdapter(), detailAdapter = 'detail' in tengdao ? tengdao : {
    detail: async () => { throw new ServiceUnavailableException('腾道企业详情尚未配置'); }
}, accountClient, contactAdapter = 'contacts' in tengdao ? tengdao : {
    contacts: async () => { throw new ServiceUnavailableException('腾道联系人尚未配置'); }
}, importerAdapter, smtpSender, umailSender, webRoot = resolve('dist/web'), evidenceProvider) {
    const parsed = new URL(origin);
    if (parsed.origin !== origin || (production && parsed.protocol !== 'https:'))
        throw new Error('APP_ORIGIN 必须是精确源；生产环境要求 HTTPS');
    const services = await createServices(pool, production, smtpAdapter, tengdao, umailAdapter, detailAdapter, accountClient, contactAdapter, importerAdapter, smtpSender, umailSender, evidenceProvider);
    const { service, emailSend } = services;
    const cookieOptions = { secure: production, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 };
    const controllers = [
        createIdentityController(services, cookieOptions),
        createOrganizationsController(services),
        createCommerceController(services),
        createCompaniesController(services),
        createEmailController(services),
        createUpstreamController(services)
    ];
    let ApplicationModule = class ApplicationModule {
    };
    ApplicationModule = __decorate([
        Module({ controllers })
    ], ApplicationModule);
    const app = await NestFactory.create(ApplicationModule, { logger: false, bodyParser: false });
    app.use((request, response, next) => {
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader('Referrer-Policy', 'no-referrer');
        response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
        if (request.path.startsWith('/api'))
            response.setHeader('Cache-Control', 'no-store');
        next();
    });
    app.use('/api/company-attachments/upload', express.json({ limit: '28mb', strict: true }));
    app.use(express.json({ limit: '8kb', strict: true }));
    app.useGlobalGuards(new IdentityGuard(service, origin));
    app.use(express.static(webRoot, { index: 'index.html' }));
    const consolePaths = new Set([
        '/platform/ledger/procurement',
        '/platform/organizations/business-data',
        '/platform/settings/umail', '/platform/settings/email-quota',
        '/platform/overview', '/platform/organizations', '/platform/ledger', '/platform/ledger/profit', '/platform/ledger/flows', '/platform/reconciliation', '/platform/reconciliation/upstream', '/platform/settings',
        '/distribution/organizations', '/distribution/orders', '/distribution/profit',
        '/terminal/search', '/terminal/profiles', '/terminal/emails', '/terminal/sending-settings', '/terminal/members', '/terminal/usage',
        '/account/settings', '/help'
    ]);
    app.use((request, response, next) => {
        if ((request.method === 'GET' || request.method === 'HEAD') && consolePaths.has(request.path)) {
            response.sendFile(resolve(webRoot, 'index.html'), { dotfiles: 'allow' });
            return;
        }
        next();
    });
    app.enableShutdownHooks();
    await emailSend.pauseExpired();
    let midnightTimer;
    const scheduleMidnight = () => {
        const shanghaiOffset = 8 * 60 * 60 * 1000;
        const nextDay = Math.floor((Date.now() + shanghaiOffset) / 86400000 + 1) * 86400000 - shanghaiOffset;
        midnightTimer = setTimeout(() => {
            void emailSend.pauseExpired().catch(() => undefined).finally(scheduleMidnight);
        }, Math.max(1, nextDay - Date.now()));
        midnightTimer.unref();
    };
    scheduleMidnight();
    app.getHttpServer().on('close', () => clearTimeout(midnightTimer));
    return app;
}
//# sourceMappingURL=app.js.map