import 'reflect-metadata';
import { Module, ServiceUnavailableException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express, { type Request, type Response } from 'express';
import { resolve } from 'node:path';
import type pg from 'pg';
import type { TengdaoCompanyClient } from './upstream/tengdao.js';
import type { CompanyDetailClient } from './companies/company-detail.js';
import type { CompanyContactClient } from './companies/company-contacts.js';
import type { ImporterNameClient } from './companies/product-search.js';
import type { UpstreamAccountClient } from './upstream/upstream-monitor.js';
import { DeferredDomesticSmtpAdapter, type DomesticSmtpAdapter } from './email/smtp-channel.js';
import { DeferredUMailAdapter, type UMailAdapter } from './email/umail.js';
import type { DeliveryEvidenceProvider, DomesticSmtpSender, UMailSender } from './email/email-send.js';
import { IdentityGuard } from './identity/guard.js';
import { createServices } from './composition/services.js';
import { createIdentityController } from './identity/controller.js';
import { createOrganizationsController } from './organizations/controller.js';
import { createCommerceController } from './commerce/controller.js';
import { createCompaniesController } from './companies/controller.js';
import { createEmailController } from './email/controller.js';
import { createUpstreamController } from './upstream/controller.js';

const unavailableTengdao: TengdaoCompanyClient = {
  listCompanies: async () => { throw new ServiceUnavailableException('腾道企业查询尚未配置'); }
};
export async function createApplication(
  pool: pg.Pool,
  origin: string,
  production = false,
  smtpAdapter: DomesticSmtpAdapter = new DeferredDomesticSmtpAdapter(),
  tengdao: TengdaoCompanyClient = unavailableTengdao,
  umailAdapter: UMailAdapter = new DeferredUMailAdapter(),
  detailAdapter: CompanyDetailClient = 'detail' in tengdao ? tengdao as TengdaoCompanyClient & CompanyDetailClient : {
    detail: async () => { throw new ServiceUnavailableException('腾道企业详情尚未配置'); }
  },
  accountClient?: UpstreamAccountClient,
  contactAdapter: CompanyContactClient = 'contacts' in tengdao ? tengdao as TengdaoCompanyClient & CompanyContactClient : {
    contacts: async () => { throw new ServiceUnavailableException('腾道联系人尚未配置'); }
  },
  importerAdapter?: ImporterNameClient,
  smtpSender?: DomesticSmtpSender,
  umailSender?: UMailSender,
  webRoot = resolve('dist/web'),
  evidenceProvider?: DeliveryEvidenceProvider
) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (production && parsed.protocol !== 'https:'))
    throw new Error('APP_ORIGIN 必须是精确源；生产环境要求 HTTPS');
  const services = await createServices(
    pool, production, smtpAdapter, tengdao, umailAdapter, detailAdapter,
    accountClient, contactAdapter, importerAdapter, smtpSender, umailSender,
    evidenceProvider
  );
  const { service, emailSend } = services;
  const cookieOptions = { secure: production, sameSite: 'strict' as const, path: '/', maxAge: 8 * 60 * 60 * 1000 };
  const controllers = [
    createIdentityController(services, cookieOptions),
    createOrganizationsController(services),
    createCommerceController(services),
    createCompaniesController(services),
    createEmailController(services),
    createUpstreamController(services)
  ];
  @Module({ controllers })
  class ApplicationModule {}
  const app = await NestFactory.create(ApplicationModule, { logger: false, bodyParser: false });
  app.use((request: Request, response: Response, next: () => void) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if (request.path.startsWith('/api')) response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api/company-attachments/upload', express.json({ limit: '28mb', strict: true }));
  app.use(express.json({ limit: '8kb', strict: true }));
  app.useGlobalGuards(new IdentityGuard(service, origin));
  app.use(express.static(webRoot, { index: 'index.html' }));
  // No SPA fallback for /api: unknown endpoints never become publicly accessible business routes.
  app.enableShutdownHooks();
  await emailSend.pauseExpired();
  let midnightTimer: NodeJS.Timeout;
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
