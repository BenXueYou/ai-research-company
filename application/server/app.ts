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
import { bindContactKey, contactKey, OrganizationService } from './organizations.js';
import { ProcurementService } from './procurement.js';
import { CoefficientService } from './coefficient.js';
import { PointOrderService } from './orders.js';
import { MemberService } from './members.js';
import { PasswordResetService } from './password-resets.js';
import { ServiceUnavailableException } from '@nestjs/common';
import { CompanySearchService } from './company-search.js';
import { ProductSearchService, type ImporterNameClient } from './product-search.js';
import { CompanyDetailService, type CompanyDetailClient } from './company-detail.js';
import { CompanyTimelineService } from './company-timeline.js';
import { CompanyAttachmentService } from './company-attachments.js';
import { DetailReconciliationService } from './detail-reconciliation.js';
import { ContactReconciliationService } from './contact-reconciliation.js';
import { ProductReconciliationService } from './product-reconciliation.js';
import { CompanyContactService, type CompanyContactClient } from './company-contacts.js';
import { EmailPreviewService } from './email-preview.js';
import { EmailSendService, type DomesticSmtpSender, type UMailSender } from './email-send.js';
import type { TengdaoCompanyClient } from './tengdao.js';
import { UpstreamMonitorService, type UpstreamAccountClient } from './upstream-monitor.js';
import {
  bindSmtpCredentialKey,
  DeferredDomesticSmtpAdapter,
  type DomesticSmtpAdapter,
  smtpCredentialKey,
  SmtpChannelService
} from './smtp-channel.js';
import {
  DeferredUMailAdapter,
  type UMailAdapter,
  UMailService
} from './umail.js';

interface AuthRequest extends Request { identity: Identity; sessionToken: string }
const unavailableTengdao: TengdaoCompanyClient = {
  listCompanies: async () => { throw new ServiceUnavailableException('腾道企业查询尚未配置'); }
};
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
  webRoot = resolve('dist/web')
) {
  const parsed = new URL(origin);
  if (parsed.origin !== origin || (production && parsed.protocol !== 'https:'))
    throw new Error('APP_ORIGIN 必须是精确源；生产环境要求 HTTPS');
  const service = new IdentityService(pool);
  const key = contactKey();
  await bindContactKey(pool, key);
  const organizations = new OrganizationService(pool, key);
  const procurement = new ProcurementService(pool, production);
  const coefficient = new CoefficientService(pool, accountClient);
  const pointOrders = new PointOrderService(pool);
  const members = new MemberService(pool);
  const passwordResets = new PasswordResetService(pool);
  const companySearch = new CompanySearchService(pool, tengdao);
  const productSearch = new ProductSearchService(pool, importerAdapter, companySearch, production);
  const companyDetail = new CompanyDetailService(pool, detailAdapter, production);
  const companyTimeline = new CompanyTimelineService(pool, key);
  const companyAttachments = new CompanyAttachmentService(pool);
  const detailReconciliation = new DetailReconciliationService(pool);
  const contactReconciliation = new ContactReconciliationService(pool);
  const productReconciliation = new ProductReconciliationService(pool);
  const companyContacts = new CompanyContactService(pool, contactAdapter, production);
  const emailPreview = new EmailPreviewService(pool);
  const upstreamMonitor = new UpstreamMonitorService(pool, accountClient);
  const smtpKey = smtpCredentialKey();
  await bindSmtpCredentialKey(pool, smtpKey);
  const smtpChannels = new SmtpChannelService(pool, smtpKey, smtpAdapter);
  const emailSend = new EmailSendService(pool, smtpKey, smtpSender, umailSender);
  const umail = new UMailService(pool, umailAdapter);
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
    @Get('upstream-monitor')
    upstreamOverview(@Req() request: AuthRequest) {
      return upstreamMonitor.overview(request.identity);
    }
    @Post('upstream-monitor/refresh')
    @HttpCode(200)
    upstreamRefresh(@Req() request: AuthRequest) {
      return upstreamMonitor.refresh(request.identity);
    }
    @Get('procurement')
    procurementOverview(@Req() request: AuthRequest) {
      return procurement.overview(request.identity, request.sessionToken);
    }
    @Get('coefficient')
    coefficientOverview(@Req() request: AuthRequest) {
      return coefficient.overview(request.identity, request.sessionToken);
    }
    @Get('coefficient/notices')
    coefficientNotices() {
      return coefficient.notices();
    }
    @Post('coefficient/announcements')
    announceCoefficient(@Req() request: AuthRequest) {
      return coefficient.announce(request.identity, request.sessionToken, request.body ?? {});
    }
    @Post('coefficient/activate')
    activateCoefficient(@Req() request: AuthRequest) {
      return coefficient.activate(request.identity, request.sessionToken, request.body?.id);
    }
    @Get('point-orders')
    pointOrderOverview(@Req() request: AuthRequest) {
      return pointOrders.overview(request.identity, request.sessionToken);
    }
    @Post('point-orders')
    createPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'create', request.body ?? {});
    }
    @Post('point-orders/reprice')
    repricePointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'reprice', request.body ?? {});
    }
    @Post('point-orders/confirm')
    confirmPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'confirm', request.body ?? {});
    }
    @Post('point-orders/transfer')
    transferPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'transfer', request.body ?? {});
    }
    @Post('point-orders/refund')
    refundPointOrder(@Req() request: AuthRequest) {
      return pointOrders.mutate(request.identity, request.sessionToken, 'refund', request.body ?? {});
    }
    @Post('procurement/purchases')
    purchase(@Req() request: AuthRequest) {
      return procurement.mutate(request.identity, request.sessionToken, 'purchase', request.body ?? {});
    }
    @Post('procurement/expenses')
    expense(@Req() request: AuthRequest) {
      return procurement.mutate(request.identity, request.sessionToken, 'expense', request.body ?? {});
    }
    @Post('procurement/pricing')
    pricing(@Req() request: AuthRequest) {
      return procurement.mutate(request.identity, request.sessionToken, 'pricing', request.body ?? {});
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
    @Post('company-searches')
    @HttpCode(200)
    searchCompanies(@Req() request: AuthRequest) {
      return companySearch.search(request.identity, request.body ?? {});
    }
    @Post('company-candidates/verify')
    @HttpCode(200)
    verifyCompanyCandidate(@Req() request: AuthRequest) {
      return companySearch.verify(request.identity, request.body ?? {});
    }
    @Post('product-searches/quote')
    @HttpCode(200)
    quoteProductPage(@Req() request: AuthRequest) {
      return productSearch.quote(request.identity, request.body ?? {});
    }
    @Post('product-searches/execute')
    @HttpCode(200)
    executeProductPage(@Req() request: AuthRequest) {
      return productSearch.execute(request.identity, request.body ?? {});
    }
    @Post('product-searches/page')
    @HttpCode(200)
    productPage(@Req() request: AuthRequest) {
      return productSearch.get(request.identity, request.body ?? {});
    }
    @Get('product-searches/reconciliations')
    productReconciliations(@Req() request: AuthRequest) {
      return productReconciliation.list(request.identity);
    }
    @Post('product-searches/reconciliations')
    @HttpCode(200)
    reconcileProductSearch(@Req() request: AuthRequest) {
      return productReconciliation.reconcile(request.identity, request.body ?? {});
    }
    @Post('product-searches/late-results')
    @HttpCode(200)
    recordLateProductSearch(@Req() request: AuthRequest) {
      return productReconciliation.lateResult(request.identity, request.body ?? {});
    }
    @Post('product-candidates/check')
    @HttpCode(200)
    checkProductCandidate(@Req() request: AuthRequest) {
      return productSearch.checkCandidate(request.identity, request.body ?? {});
    }
    @Post('company-details/quote')
    @HttpCode(200)
    quoteCompanyDetail(@Req() request: AuthRequest) {
      return companyDetail.quote(request.identity, request.body ?? {});
    }
    @Post('company-details/execute')
    @HttpCode(200)
    executeCompanyDetail(@Req() request: AuthRequest) {
      return companyDetail.execute(request.identity, request.body ?? {});
    }
    @Get('company-profiles')
    companyProfiles(@Req() request: AuthRequest) {
      return companyDetail.profiles(request.identity);
    }
    @Post('company-timeline/list')
    @HttpCode(200)
    listCompanyTimeline(@Req() request: AuthRequest) {
      return companyTimeline.list(request.identity, request.body ?? {});
    }
    @Post('company-timeline/create')
    @HttpCode(200)
    createCompanyTimeline(@Req() request: AuthRequest) {
      return companyTimeline.create(request.identity, request.body ?? {});
    }
    @Post('company-timeline/edit')
    @HttpCode(200)
    editCompanyTimeline(@Req() request: AuthRequest) {
      return companyTimeline.edit(request.identity, request.body ?? {});
    }
    @Post('company-timeline/delete')
    @HttpCode(200)
    deleteCompanyTimeline(@Req() request: AuthRequest) {
      return companyTimeline.remove(request.identity, request.body ?? {});
    }
    @Post('company-attachments/list')
    @HttpCode(200)
    listCompanyAttachments(@Req() request: AuthRequest) {
      return companyAttachments.list(request.identity, request.body ?? {});
    }
    @Post('company-attachments/upload')
    @HttpCode(200)
    uploadCompanyAttachment(@Req() request: AuthRequest) {
      return companyAttachments.upload(request.identity, request.body ?? {});
    }
    @Post('company-attachments/download')
    @HttpCode(200)
    downloadCompanyAttachment(@Req() request: AuthRequest) {
      return companyAttachments.download(request.identity, request.body ?? {});
    }
    @Post('company-attachments/delete')
    @HttpCode(200)
    deleteCompanyAttachment(@Req() request: AuthRequest) {
      return companyAttachments.remove(request.identity, request.body ?? {});
    }
    @Post('company-attachments/clean-expired')
    @HttpCode(200)
    cleanExpiredCompanyAttachment(@Req() request: AuthRequest) {
      return companyAttachments.cleanExpired(request.identity, request.body ?? {});
    }
    @Post('company-contacts/quote')
    @HttpCode(200)
    quoteCompanyContacts(@Req() request: AuthRequest) {
      return companyContacts.quote(request.identity, request.body ?? {});
    }
    @Post('company-contacts/execute')
    @HttpCode(200)
    executeCompanyContacts(@Req() request: AuthRequest) {
      return companyContacts.execute(request.identity, request.body ?? {});
    }
    @Post('company-contacts/profile')
    @HttpCode(200)
    profileContacts(@Req() request: AuthRequest) {
      return companyContacts.profile(request.identity, request.body ?? {});
    }
    @Post('company-contacts/confirm-ownership')
    @HttpCode(200)
    confirmContactOwnership(@Req() request: AuthRequest) {
      return emailPreview.confirmOwnership(request.identity, request.body ?? {});
    }
    @Post('company-contacts/unsubscribed')
    @HttpCode(200)
    markContactUnsubscribed(@Req() request: AuthRequest) {
      return emailPreview.markUnsubscribed(request.identity, request.body ?? {});
    }
    @Get('public-templates')
    publicTemplates(@Req() request: AuthRequest) {
      return emailPreview.templates(request.identity);
    }
    @Post('email-drafts')
    @HttpCode(200)
    saveEmailDraft(@Req() request: AuthRequest) {
      return emailPreview.saveDraft(request.identity, request.body ?? {});
    }
    @Post('email-drafts/preview')
    @HttpCode(200)
    previewEmailDraft(@Req() request: AuthRequest) {
      return emailPreview.preview(request.identity, request.body ?? {});
    }
    @Post('email-previews/confirm')
    @HttpCode(200)
    confirmEmailPreview(@Req() request: AuthRequest) {
      return emailPreview.confirm(request.identity, request.body ?? {});
    }
    @Get('email-quota')
    emailQuota(@Req() request: AuthRequest) {
      return emailSend.quota(request.identity);
    }
    @Post('email-quota/configure')
    configureEmailQuota(@Req() request: AuthRequest) {
      return emailSend.configureLimit(request.identity, request.body ?? {});
    }
    @Post('email-batches/confirm')
    confirmEmailBatch(@Req() request: AuthRequest) {
      return emailSend.confirm(request.identity, request.body ?? {});
    }
    @Post('email-batches/execute')
    executeEmailBatch(@Req() request: AuthRequest) {
      return emailSend.execute(request.identity, request.body ?? {});
    }
    @Get('email-batches')
    emailBatches(@Req() request: AuthRequest) {
      return emailSend.list(request.identity);
    }
    @Post('email-batches/detail')
    emailBatch(@Req() request: AuthRequest) {
      return emailSend.batch(request.identity, request.body?.batchId);
    }
    @Post('company-contacts/final-failure')
    @HttpCode(200)
    finalCompanyContactsFailure(@Req() request: AuthRequest) {
      return companyContacts.finalFailure(request.identity, request.body ?? {});
    }
    @Get('company-contacts/reconciliations')
    contactReconciliations(@Req() request: AuthRequest) {
      return contactReconciliation.list(request.identity);
    }
    @Post('company-contacts/reconciliations')
    @HttpCode(200)
    reconcileCompanyContacts(@Req() request: AuthRequest) {
      return contactReconciliation.reconcile(request.identity, request.body ?? {});
    }
    @Post('company-contacts/late-results')
    @HttpCode(200)
    recordLateCompanyContacts(@Req() request: AuthRequest) {
      return contactReconciliation.lateResult(request.identity, request.body ?? {});
    }
    @Post('company-details/final-failure')
    @HttpCode(200)
    finalCompanyDetailFailure(@Req() request: AuthRequest) {
      return companyDetail.confirmFinalFailure(request.identity, request.body ?? {});
    }
    @Get('company-details/reconciliations')
    detailReconciliations(@Req() request: AuthRequest) {
      return detailReconciliation.list(request.identity);
    }
    @Post('company-details/reconciliations')
    @HttpCode(200)
    reconcileCompanyDetail(@Req() request: AuthRequest) {
      return detailReconciliation.reconcile(request.identity, request.body ?? {});
    }
    @Post('company-details/late-results')
    @HttpCode(200)
    recordLateCompanyDetail(@Req() request: AuthRequest) {
      return detailReconciliation.lateResult(request.identity, request.body ?? {});
    }
    @Get('sending-channels/smtp')
    smtpChannel(@Req() request: AuthRequest) {
      return smtpChannels.get(request.identity);
    }
    @Post('sending-channels/smtp')
    configureSmtpChannel(@Req() request: AuthRequest) {
      return smtpChannels.configure(request.identity, request.body ?? {});
    }
    @Get('umail/resources')
    umailResources(@Req() request: AuthRequest) {
      return umail.listResources(request.identity);
    }
    @Post('umail/resources')
    configureUMailResource(@Req() request: AuthRequest) {
      return umail.configureResource(request.identity, request.sessionToken, request.body ?? {});
    }
    @Get('sending-channels/umail')
    umailChannel(@Req() request: AuthRequest) {
      return umail.getChannel(request.identity);
    }
    @Post('sending-channels/umail')
    configureUMailChannel(@Req() request: AuthRequest) {
      return umail.saveChannel(request.identity, request.sessionToken, request.body ?? {});
    }
    @Get('organizations')
    organizations(@Req() request: AuthRequest) {
      return organizations.list(request.identity);
    }
    @Post('organizations')
    openOrganization(@Req() request: AuthRequest) {
      return organizations.open(request.identity, request.sessionToken, request.body ?? {});
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
  app.use('/api/company-attachments/upload', express.json({ limit: '28mb', strict: true }));
  app.use(express.json({ limit: '8kb', strict: true }));
  app.useGlobalGuards(new IdentityGuard(service, origin));
  app.use(express.static(webRoot, { index: 'index.html' }));
  // No SPA fallback for /api: unknown endpoints never become publicly accessible business routes.
  app.enableShutdownHooks();
  return app;
}
