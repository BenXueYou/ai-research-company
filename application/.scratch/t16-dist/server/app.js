var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import 'reflect-metadata';
import { Controller, ForbiddenException, Get, HttpCode, Module, Post, Req, Res } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import express from 'express';
import { resolve } from 'node:path';
import { timingSafeEqual } from 'node:crypto';
import { digest, IdentityService } from './identity.js';
import { bindContactKey, contactKey, OrganizationService } from './organizations.js';
import { ProcurementService } from './procurement.js';
import { CoefficientService } from './coefficient.js';
import { PointOrderService } from './orders.js';
import { MemberService } from './members.js';
import { PasswordResetService } from './password-resets.js';
import { ServiceUnavailableException } from '@nestjs/common';
import { CompanySearchService } from './company-search.js';
import { ProductSearchService } from './product-search.js';
import { CompanyDetailService } from './company-detail.js';
import { CompanyProfileService } from './company-profiles.js';
import { CompanyTimelineService } from './company-timeline.js';
import { CompanyAttachmentService } from './company-attachments.js';
import { DetailReconciliationService } from './detail-reconciliation.js';
import { ContactReconciliationService } from './contact-reconciliation.js';
import { ProductReconciliationService } from './product-reconciliation.js';
import { CompanyContactService } from './company-contacts.js';
import { EmailPreviewService } from './email-preview.js';
import { EmailSendService } from './email-send.js';
import { UpstreamMonitorService } from './upstream-monitor.js';
import { bindSmtpCredentialKey, DeferredDomesticSmtpAdapter, smtpCredentialKey, SmtpChannelService } from './smtp-channel.js';
import { DeferredUMailAdapter, UMailService } from './umail.js';
const unavailableTengdao = {
    listCompanies: async () => { throw new ServiceUnavailableException('腾道企业查询尚未配置'); }
};
function cookie(request, name) {
    const pair = request.headers.cookie?.split(';').map(item => item.trim()).find(item => item.startsWith(`${name}=`));
    return pair?.slice(name.length + 1) ?? '';
}
class IdentityGuard {
    service;
    origin;
    constructor(service, origin) {
        this.service = service;
        this.origin = origin;
    }
    async canActivate(context) {
        const request = context.switchToHttp().getRequest();
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
export async function createApplication(pool, origin, production = false, smtpAdapter = new DeferredDomesticSmtpAdapter(), tengdao = unavailableTengdao, umailAdapter = new DeferredUMailAdapter(), detailAdapter = 'detail' in tengdao ? tengdao : {
    detail: async () => { throw new ServiceUnavailableException('腾道企业详情尚未配置'); }
}, accountClient, contactAdapter = 'contacts' in tengdao ? tengdao : {
    contacts: async () => { throw new ServiceUnavailableException('腾道联系人尚未配置'); }
}, importerAdapter, smtpSender, umailSender, webRoot = resolve('dist/web'), evidenceProvider) {
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
    const companyProfiles = new CompanyProfileService(pool);
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
    const emailSend = new EmailSendService(pool, smtpKey, smtpSender, umailSender, evidenceProvider);
    const umail = new UMailService(pool, umailAdapter);
    const cookieOptions = { secure: production, sameSite: 'strict', path: '/', maxAge: 8 * 60 * 60 * 1000 };
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
        upstreamOverview(request) {
            return upstreamMonitor.overview(request.identity);
        }
        upstreamRefresh(request) {
            return upstreamMonitor.refresh(request.identity);
        }
        procurementOverview(request) {
            return procurement.overview(request.identity, request.sessionToken);
        }
        coefficientOverview(request) {
            return coefficient.overview(request.identity, request.sessionToken);
        }
        coefficientNotices() {
            return coefficient.notices();
        }
        announceCoefficient(request) {
            return coefficient.announce(request.identity, request.sessionToken, request.body ?? {});
        }
        activateCoefficient(request) {
            return coefficient.activate(request.identity, request.sessionToken, request.body?.id);
        }
        pointOrderOverview(request) {
            return pointOrders.overview(request.identity, request.sessionToken);
        }
        createPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'create', request.body ?? {});
        }
        repricePointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'reprice', request.body ?? {});
        }
        confirmPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'confirm', request.body ?? {});
        }
        transferPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'transfer', request.body ?? {});
        }
        refundPointOrder(request) {
            return pointOrders.mutate(request.identity, request.sessionToken, 'refund', request.body ?? {});
        }
        purchase(request) {
            return procurement.mutate(request.identity, request.sessionToken, 'purchase', request.body ?? {});
        }
        expense(request) {
            return procurement.mutate(request.identity, request.sessionToken, 'expense', request.body ?? {});
        }
        pricing(request) {
            return procurement.mutate(request.identity, request.sessionToken, 'pricing', request.body ?? {});
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
        searchCompanies(request) {
            return companySearch.search(request.identity, request.body ?? {});
        }
        verifyCompanyCandidate(request) {
            return companySearch.verify(request.identity, request.body ?? {});
        }
        quoteProductPage(request) {
            return productSearch.quote(request.identity, request.body ?? {});
        }
        executeProductPage(request) {
            return productSearch.execute(request.identity, request.body ?? {});
        }
        productPage(request) {
            return productSearch.get(request.identity, request.body ?? {});
        }
        productReconciliations(request) {
            return productReconciliation.list(request.identity);
        }
        reconcileProductSearch(request) {
            return productReconciliation.reconcile(request.identity, request.body ?? {});
        }
        recordLateProductSearch(request) {
            return productReconciliation.lateResult(request.identity, request.body ?? {});
        }
        checkProductCandidate(request) {
            return productSearch.checkCandidate(request.identity, request.body ?? {});
        }
        quoteCompanyDetail(request) {
            return companyDetail.quote(request.identity, request.body ?? {});
        }
        quoteCompanyDetailRefresh(request) {
            return companyDetail.quoteRefresh(request.identity, request.body ?? {});
        }
        executeCompanyDetail(request) {
            return companyDetail.execute(request.identity, request.body ?? {});
        }
        companyProfiles(request) {
            return companyDetail.profiles(request.identity);
        }
        listCompanyProfiles(request) {
            return companyProfiles.list(request.identity, request.body ?? {});
        }
        updateCompanyProfile(request) {
            return companyProfiles.update(request.identity, request.body ?? {});
        }
        deleteCompanyProfile(request) {
            return companyProfiles.setDeleted(request.identity, request.body ?? {}, true);
        }
        restoreCompanyProfile(request) {
            return companyProfiles.setDeleted(request.identity, request.body ?? {}, false);
        }
        companyProfileHistory(request) {
            return companyProfiles.history(request.identity, request.body ?? {});
        }
        listCompanyTimeline(request) {
            return companyTimeline.list(request.identity, request.body ?? {});
        }
        createCompanyTimeline(request) {
            return companyTimeline.create(request.identity, request.body ?? {});
        }
        editCompanyTimeline(request) {
            return companyTimeline.edit(request.identity, request.body ?? {});
        }
        deleteCompanyTimeline(request) {
            return companyTimeline.remove(request.identity, request.body ?? {});
        }
        listCompanyAttachments(request) {
            return companyAttachments.list(request.identity, request.body ?? {});
        }
        uploadCompanyAttachment(request) {
            return companyAttachments.upload(request.identity, request.body ?? {});
        }
        downloadCompanyAttachment(request) {
            return companyAttachments.download(request.identity, request.body ?? {});
        }
        deleteCompanyAttachment(request) {
            return companyAttachments.remove(request.identity, request.body ?? {});
        }
        cleanExpiredCompanyAttachment(request) {
            return companyAttachments.cleanExpired(request.identity, request.body ?? {});
        }
        quoteCompanyContacts(request) {
            return companyContacts.quote(request.identity, request.body ?? {});
        }
        quoteCompanyContactsRefresh(request) {
            return companyContacts.quoteRefresh(request.identity, request.body ?? {});
        }
        executeCompanyContacts(request) {
            return companyContacts.execute(request.identity, request.body ?? {});
        }
        profileContacts(request) {
            return companyContacts.profile(request.identity, request.body ?? {});
        }
        confirmContactOwnership(request) {
            return emailPreview.confirmOwnership(request.identity, request.body ?? {});
        }
        markContactUnsubscribed(request) {
            return emailPreview.markUnsubscribed(request.identity, request.body ?? {});
        }
        publicTemplates(request) {
            return emailPreview.templates(request.identity);
        }
        saveEmailDraft(request) {
            return emailPreview.saveDraft(request.identity, request.body ?? {});
        }
        previewEmailDraft(request) {
            return emailPreview.preview(request.identity, request.body ?? {});
        }
        confirmEmailPreview(request) {
            return emailPreview.confirm(request.identity, request.body ?? {});
        }
        emailQuota(request) {
            return emailSend.quota(request.identity);
        }
        configureEmailQuota(request) {
            return emailSend.configureLimit(request.identity, request.body ?? {});
        }
        confirmEmailBatch(request) {
            return emailSend.confirm(request.identity, request.body ?? {});
        }
        executeEmailBatch(request) {
            return emailSend.execute(request.identity, request.body ?? {});
        }
        emailBatches(request) {
            return emailSend.list(request.identity);
        }
        emailBatch(request) {
            return emailSend.batch(request.identity, request.body?.batchId);
        }
        reconcileEmailRecipient(request) {
            return emailSend.reconcile(request.identity, request.body ?? {});
        }
        retryEmailRecipient(request) {
            return emailSend.retry(request.identity, request.body ?? {});
        }
        reconfirmEmailRecipient(request) {
            return emailSend.reconfirm(request.identity, request.body ?? {});
        }
        executeReconfirmedRecipient(request) {
            return emailSend.executeRecipient(request.identity, request.body ?? {});
        }
        finalCompanyContactsFailure(request) {
            return companyContacts.finalFailure(request.identity, request.body ?? {});
        }
        contactReconciliations(request) {
            return contactReconciliation.list(request.identity);
        }
        reconcileCompanyContacts(request) {
            return contactReconciliation.reconcile(request.identity, request.body ?? {});
        }
        recordLateCompanyContacts(request) {
            return contactReconciliation.lateResult(request.identity, request.body ?? {});
        }
        finalCompanyDetailFailure(request) {
            return companyDetail.confirmFinalFailure(request.identity, request.body ?? {});
        }
        detailReconciliations(request) {
            return detailReconciliation.list(request.identity);
        }
        reconcileCompanyDetail(request) {
            return detailReconciliation.reconcile(request.identity, request.body ?? {});
        }
        recordLateCompanyDetail(request) {
            return detailReconciliation.lateResult(request.identity, request.body ?? {});
        }
        smtpChannel(request) {
            return smtpChannels.get(request.identity);
        }
        configureSmtpChannel(request) {
            return smtpChannels.configure(request.identity, request.body ?? {});
        }
        umailResources(request) {
            return umail.listResources(request.identity);
        }
        configureUMailResource(request) {
            return umail.configureResource(request.identity, request.sessionToken, request.body ?? {});
        }
        umailChannel(request) {
            return umail.getChannel(request.identity);
        }
        configureUMailChannel(request) {
            return umail.saveChannel(request.identity, request.sessionToken, request.body ?? {});
        }
        organizations(request) {
            return organizations.list(request.identity);
        }
        openOrganization(request) {
            return organizations.open(request.identity, request.sessionToken, request.body ?? {});
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
        Get('upstream-monitor'),
        __param(0, Req())
    ], IdentityController.prototype, "upstreamOverview", null);
    __decorate([
        Post('upstream-monitor/refresh'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "upstreamRefresh", null);
    __decorate([
        Get('procurement'),
        __param(0, Req())
    ], IdentityController.prototype, "procurementOverview", null);
    __decorate([
        Get('coefficient'),
        __param(0, Req())
    ], IdentityController.prototype, "coefficientOverview", null);
    __decorate([
        Get('coefficient/notices')
    ], IdentityController.prototype, "coefficientNotices", null);
    __decorate([
        Post('coefficient/announcements'),
        __param(0, Req())
    ], IdentityController.prototype, "announceCoefficient", null);
    __decorate([
        Post('coefficient/activate'),
        __param(0, Req())
    ], IdentityController.prototype, "activateCoefficient", null);
    __decorate([
        Get('point-orders'),
        __param(0, Req())
    ], IdentityController.prototype, "pointOrderOverview", null);
    __decorate([
        Post('point-orders'),
        __param(0, Req())
    ], IdentityController.prototype, "createPointOrder", null);
    __decorate([
        Post('point-orders/reprice'),
        __param(0, Req())
    ], IdentityController.prototype, "repricePointOrder", null);
    __decorate([
        Post('point-orders/confirm'),
        __param(0, Req())
    ], IdentityController.prototype, "confirmPointOrder", null);
    __decorate([
        Post('point-orders/transfer'),
        __param(0, Req())
    ], IdentityController.prototype, "transferPointOrder", null);
    __decorate([
        Post('point-orders/refund'),
        __param(0, Req())
    ], IdentityController.prototype, "refundPointOrder", null);
    __decorate([
        Post('procurement/purchases'),
        __param(0, Req())
    ], IdentityController.prototype, "purchase", null);
    __decorate([
        Post('procurement/expenses'),
        __param(0, Req())
    ], IdentityController.prototype, "expense", null);
    __decorate([
        Post('procurement/pricing'),
        __param(0, Req())
    ], IdentityController.prototype, "pricing", null);
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
    __decorate([
        Post('company-searches'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "searchCompanies", null);
    __decorate([
        Post('company-candidates/verify'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "verifyCompanyCandidate", null);
    __decorate([
        Post('product-searches/quote'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "quoteProductPage", null);
    __decorate([
        Post('product-searches/execute'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "executeProductPage", null);
    __decorate([
        Post('product-searches/page'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "productPage", null);
    __decorate([
        Get('product-searches/reconciliations'),
        __param(0, Req())
    ], IdentityController.prototype, "productReconciliations", null);
    __decorate([
        Post('product-searches/reconciliations'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "reconcileProductSearch", null);
    __decorate([
        Post('product-searches/late-results'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "recordLateProductSearch", null);
    __decorate([
        Post('product-candidates/check'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "checkProductCandidate", null);
    __decorate([
        Post('company-details/quote'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "quoteCompanyDetail", null);
    __decorate([
        Post('company-details/refresh-quote'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "quoteCompanyDetailRefresh", null);
    __decorate([
        Post('company-details/execute'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "executeCompanyDetail", null);
    __decorate([
        Get('company-profiles'),
        __param(0, Req())
    ], IdentityController.prototype, "companyProfiles", null);
    __decorate([
        Post('company-profiles/list'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "listCompanyProfiles", null);
    __decorate([
        Post('company-profiles/update'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "updateCompanyProfile", null);
    __decorate([
        Post('company-profiles/delete'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "deleteCompanyProfile", null);
    __decorate([
        Post('company-profiles/restore'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "restoreCompanyProfile", null);
    __decorate([
        Post('company-profiles/history'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "companyProfileHistory", null);
    __decorate([
        Post('company-timeline/list'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "listCompanyTimeline", null);
    __decorate([
        Post('company-timeline/create'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "createCompanyTimeline", null);
    __decorate([
        Post('company-timeline/edit'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "editCompanyTimeline", null);
    __decorate([
        Post('company-timeline/delete'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "deleteCompanyTimeline", null);
    __decorate([
        Post('company-attachments/list'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "listCompanyAttachments", null);
    __decorate([
        Post('company-attachments/upload'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "uploadCompanyAttachment", null);
    __decorate([
        Post('company-attachments/download'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "downloadCompanyAttachment", null);
    __decorate([
        Post('company-attachments/delete'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "deleteCompanyAttachment", null);
    __decorate([
        Post('company-attachments/clean-expired'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "cleanExpiredCompanyAttachment", null);
    __decorate([
        Post('company-contacts/quote'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "quoteCompanyContacts", null);
    __decorate([
        Post('company-contacts/refresh-quote'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "quoteCompanyContactsRefresh", null);
    __decorate([
        Post('company-contacts/execute'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "executeCompanyContacts", null);
    __decorate([
        Post('company-contacts/profile'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "profileContacts", null);
    __decorate([
        Post('company-contacts/confirm-ownership'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "confirmContactOwnership", null);
    __decorate([
        Post('company-contacts/unsubscribed'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "markContactUnsubscribed", null);
    __decorate([
        Get('public-templates'),
        __param(0, Req())
    ], IdentityController.prototype, "publicTemplates", null);
    __decorate([
        Post('email-drafts'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "saveEmailDraft", null);
    __decorate([
        Post('email-drafts/preview'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "previewEmailDraft", null);
    __decorate([
        Post('email-previews/confirm'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "confirmEmailPreview", null);
    __decorate([
        Get('email-quota'),
        __param(0, Req())
    ], IdentityController.prototype, "emailQuota", null);
    __decorate([
        Post('email-quota/configure'),
        __param(0, Req())
    ], IdentityController.prototype, "configureEmailQuota", null);
    __decorate([
        Post('email-batches/confirm'),
        __param(0, Req())
    ], IdentityController.prototype, "confirmEmailBatch", null);
    __decorate([
        Post('email-batches/execute'),
        __param(0, Req())
    ], IdentityController.prototype, "executeEmailBatch", null);
    __decorate([
        Get('email-batches'),
        __param(0, Req())
    ], IdentityController.prototype, "emailBatches", null);
    __decorate([
        Post('email-batches/detail'),
        __param(0, Req())
    ], IdentityController.prototype, "emailBatch", null);
    __decorate([
        Post('email-recipients/reconcile'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "reconcileEmailRecipient", null);
    __decorate([
        Post('email-recipients/retry'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "retryEmailRecipient", null);
    __decorate([
        Post('email-recipients/reconfirm'),
        __param(0, Req())
    ], IdentityController.prototype, "reconfirmEmailRecipient", null);
    __decorate([
        Post('email-recipients/execute'),
        __param(0, Req())
    ], IdentityController.prototype, "executeReconfirmedRecipient", null);
    __decorate([
        Post('company-contacts/final-failure'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "finalCompanyContactsFailure", null);
    __decorate([
        Get('company-contacts/reconciliations'),
        __param(0, Req())
    ], IdentityController.prototype, "contactReconciliations", null);
    __decorate([
        Post('company-contacts/reconciliations'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "reconcileCompanyContacts", null);
    __decorate([
        Post('company-contacts/late-results'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "recordLateCompanyContacts", null);
    __decorate([
        Post('company-details/final-failure'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "finalCompanyDetailFailure", null);
    __decorate([
        Get('company-details/reconciliations'),
        __param(0, Req())
    ], IdentityController.prototype, "detailReconciliations", null);
    __decorate([
        Post('company-details/reconciliations'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "reconcileCompanyDetail", null);
    __decorate([
        Post('company-details/late-results'),
        HttpCode(200),
        __param(0, Req())
    ], IdentityController.prototype, "recordLateCompanyDetail", null);
    __decorate([
        Get('sending-channels/smtp'),
        __param(0, Req())
    ], IdentityController.prototype, "smtpChannel", null);
    __decorate([
        Post('sending-channels/smtp'),
        __param(0, Req())
    ], IdentityController.prototype, "configureSmtpChannel", null);
    __decorate([
        Get('umail/resources'),
        __param(0, Req())
    ], IdentityController.prototype, "umailResources", null);
    __decorate([
        Post('umail/resources'),
        __param(0, Req())
    ], IdentityController.prototype, "configureUMailResource", null);
    __decorate([
        Get('sending-channels/umail'),
        __param(0, Req())
    ], IdentityController.prototype, "umailChannel", null);
    __decorate([
        Post('sending-channels/umail'),
        __param(0, Req())
    ], IdentityController.prototype, "configureUMailChannel", null);
    __decorate([
        Get('organizations'),
        __param(0, Req())
    ], IdentityController.prototype, "organizations", null);
    __decorate([
        Post('organizations'),
        __param(0, Req())
    ], IdentityController.prototype, "openOrganization", null);
    IdentityController = __decorate([
        Controller('api')
    ], IdentityController);
    let ApplicationModule = class ApplicationModule {
    };
    ApplicationModule = __decorate([
        Module({ controllers: [IdentityController] })
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
    // No SPA fallback for /api: unknown endpoints never become publicly accessible business routes.
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