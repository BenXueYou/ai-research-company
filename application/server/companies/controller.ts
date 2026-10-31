import { Controller, Get, Post, HttpCode, Req } from '@nestjs/common';
import type { AuthRequest } from '../identity/guard.js';
import type { Services } from '../composition/services.js';

export function createCompaniesController(services: Services) {
  const { companySearch, productSearch, companyDetail, companyProfiles, companyProfileImports, companyTimeline, companyAttachments, detailReconciliation, contactReconciliation, productReconciliation, companyContacts, emailPreview } = services;
  @Controller('api')
  class CompaniesController {
    @Post('company-sources/list')
    @HttpCode(200)
    companySourceslist(@Req() request: AuthRequest) {
      return services.companySources.list(request.identity, request.body ?? {});
    }

    @Post('company-sources/select')
    @HttpCode(200)
    companySourcesselect(@Req() request: AuthRequest) {
      return services.companySources.select(request.identity, request.body ?? {});
    }

    @Post('company-sources/display')
    @HttpCode(200)
    companySourcesdisplay(@Req() request: AuthRequest) {
      return services.companySources.display(request.identity, request.body ?? {});
    }

    @Post('company-source-details/quote')
    @HttpCode(200)
    companySourceDetailsquote(@Req() request: AuthRequest) {
      return services.companySourceDetails.quote(request.identity, request.body ?? {});
    }

    @Post('company-source-details/execute')
    @HttpCode(200)
    companySourceDetailsexecute(@Req() request: AuthRequest) {
      return services.companySourceDetails.execute(request.identity, request.body ?? {});
    }

    @Post('company-source-details/status')
    @HttpCode(200)
    companySourceDetailsstatus(@Req() request: AuthRequest) {
      return services.companySourceDetails.status(request.identity, request.body ?? {});
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
    @Post('company-details/refresh-quote')
    @HttpCode(200)
    quoteCompanyDetailRefresh(@Req() request: AuthRequest) {
      return companyDetail.quoteRefresh(request.identity, request.body ?? {});
    }
    @Post('company-details/execute')
    @HttpCode(200)
    executeCompanyDetail(@Req() request: AuthRequest) {
      return companyDetail.execute(request.identity, request.body ?? {});
    }
    @Post('company-details/status')
    @HttpCode(200)
    companyDetailStatus(@Req() request: AuthRequest) {
      return companyDetail.status(request.identity, request.body ?? {});
    }
    @Get('company-profiles')
    companyProfiles(@Req() request: AuthRequest) {
      return companyDetail.profiles(request.identity);
    }
    @Post('company-profiles/list')
    @HttpCode(200)
    listCompanyProfiles(@Req() request: AuthRequest) {
      return companyProfiles.list(request.identity, request.body ?? {});
    }
    @Post('company-profile-imports')
    @HttpCode(200)
    importCompanyProfiles(@Req() request: AuthRequest) {
      return companyProfileImports.import(request.identity, request.body ?? {});
    }
    @Post('company-profile-import-resolutions')
    @HttpCode(200)
    resolveCompanyProfileImport(@Req() request: AuthRequest) {
      return companyProfileImports.import(request.identity, request.body ?? {}, true);
    }
    @Post('company-profiles/update')
    @HttpCode(200)
    updateCompanyProfile(@Req() request: AuthRequest) {
      return companyProfiles.update(request.identity, request.body ?? {});
    }
    @Post('company-profiles/delete')
    @HttpCode(200)
    deleteCompanyProfile(@Req() request: AuthRequest) {
      return companyProfiles.setDeleted(request.identity, request.body ?? {}, true);
    }
    @Post('company-profiles/restore')
    @HttpCode(200)
    restoreCompanyProfile(@Req() request: AuthRequest) {
      return companyProfiles.setDeleted(request.identity, request.body ?? {}, false);
    }
    @Post('company-profiles/history')
    @HttpCode(200)
    companyProfileHistory(@Req() request: AuthRequest) {
      return companyProfiles.history(request.identity, request.body ?? {});
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
    @Post('company-contacts/refresh-quote')
    @HttpCode(200)
    quoteCompanyContactsRefresh(@Req() request: AuthRequest) {
      return companyContacts.quoteRefresh(request.identity, request.body ?? {});
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
  }
  return CompaniesController;
}
