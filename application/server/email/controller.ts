import { Controller, Get, Post, HttpCode, Req } from '@nestjs/common';
import type { AuthRequest } from '../identity/guard.js';
import type { Services } from '../composition/services.js';

export function createEmailController(services: Services) {
  const { emailPreview, smtpChannels, emailSend, umail } = services;
  @Controller('api')
  class EmailController {
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
    @Post('email-recipients/reconcile')
    @HttpCode(200)
    reconcileEmailRecipient(@Req() request: AuthRequest) {
      return emailSend.reconcile(request.identity, request.body ?? {});
    }
    @Post('email-recipients/retry')
    @HttpCode(200)
    retryEmailRecipient(@Req() request: AuthRequest) {
      return emailSend.retry(request.identity, request.body ?? {});
    }
    @Post('email-recipients/reconfirm')
    reconfirmEmailRecipient(@Req() request: AuthRequest) {
      return emailSend.reconfirm(request.identity, request.body ?? {});
    }
    @Post('email-recipients/execute')
    executeReconfirmedRecipient(@Req() request: AuthRequest) {
      return emailSend.executeRecipient(request.identity, request.body ?? {});
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
  }
  return EmailController;
}
