var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
import { Controller, Get, Post, HttpCode, Req } from '@nestjs/common';
export function createEmailController(services) {
    const { emailPreview, smtpChannels, emailSend, umail } = services;
    let EmailController = class EmailController {
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
    };
    __decorate([
        Get('public-templates'),
        __param(0, Req())
    ], EmailController.prototype, "publicTemplates", null);
    __decorate([
        Post('email-drafts'),
        HttpCode(200),
        __param(0, Req())
    ], EmailController.prototype, "saveEmailDraft", null);
    __decorate([
        Post('email-drafts/preview'),
        HttpCode(200),
        __param(0, Req())
    ], EmailController.prototype, "previewEmailDraft", null);
    __decorate([
        Post('email-previews/confirm'),
        HttpCode(200),
        __param(0, Req())
    ], EmailController.prototype, "confirmEmailPreview", null);
    __decorate([
        Get('email-quota'),
        __param(0, Req())
    ], EmailController.prototype, "emailQuota", null);
    __decorate([
        Post('email-quota/configure'),
        __param(0, Req())
    ], EmailController.prototype, "configureEmailQuota", null);
    __decorate([
        Post('email-batches/confirm'),
        __param(0, Req())
    ], EmailController.prototype, "confirmEmailBatch", null);
    __decorate([
        Post('email-batches/execute'),
        __param(0, Req())
    ], EmailController.prototype, "executeEmailBatch", null);
    __decorate([
        Get('email-batches'),
        __param(0, Req())
    ], EmailController.prototype, "emailBatches", null);
    __decorate([
        Post('email-batches/detail'),
        __param(0, Req())
    ], EmailController.prototype, "emailBatch", null);
    __decorate([
        Post('email-recipients/reconcile'),
        HttpCode(200),
        __param(0, Req())
    ], EmailController.prototype, "reconcileEmailRecipient", null);
    __decorate([
        Post('email-recipients/retry'),
        HttpCode(200),
        __param(0, Req())
    ], EmailController.prototype, "retryEmailRecipient", null);
    __decorate([
        Post('email-recipients/reconfirm'),
        __param(0, Req())
    ], EmailController.prototype, "reconfirmEmailRecipient", null);
    __decorate([
        Post('email-recipients/execute'),
        __param(0, Req())
    ], EmailController.prototype, "executeReconfirmedRecipient", null);
    __decorate([
        Get('sending-channels/smtp'),
        __param(0, Req())
    ], EmailController.prototype, "smtpChannel", null);
    __decorate([
        Post('sending-channels/smtp'),
        __param(0, Req())
    ], EmailController.prototype, "configureSmtpChannel", null);
    __decorate([
        Get('umail/resources'),
        __param(0, Req())
    ], EmailController.prototype, "umailResources", null);
    __decorate([
        Post('umail/resources'),
        __param(0, Req())
    ], EmailController.prototype, "configureUMailResource", null);
    __decorate([
        Get('sending-channels/umail'),
        __param(0, Req())
    ], EmailController.prototype, "umailChannel", null);
    __decorate([
        Post('sending-channels/umail'),
        __param(0, Req())
    ], EmailController.prototype, "configureUMailChannel", null);
    EmailController = __decorate([
        Controller('api')
    ], EmailController);
    return EmailController;
}
//# sourceMappingURL=controller.js.map