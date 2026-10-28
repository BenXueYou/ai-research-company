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
export function createCompaniesController(services) {
    const { companySearch, productSearch, companyDetail, companyProfiles, companyTimeline, companyAttachments, detailReconciliation, contactReconciliation, productReconciliation, companyContacts, emailPreview } = services;
    let CompaniesController = class CompaniesController {
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
        companyDetailStatus(request) {
            return companyDetail.status(request.identity, request.body ?? {});
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
    };
    __decorate([
        Post('company-searches'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "searchCompanies", null);
    __decorate([
        Post('company-candidates/verify'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "verifyCompanyCandidate", null);
    __decorate([
        Post('product-searches/quote'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "quoteProductPage", null);
    __decorate([
        Post('product-searches/execute'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "executeProductPage", null);
    __decorate([
        Post('product-searches/page'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "productPage", null);
    __decorate([
        Get('product-searches/reconciliations'),
        __param(0, Req())
    ], CompaniesController.prototype, "productReconciliations", null);
    __decorate([
        Post('product-searches/reconciliations'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "reconcileProductSearch", null);
    __decorate([
        Post('product-searches/late-results'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "recordLateProductSearch", null);
    __decorate([
        Post('product-candidates/check'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "checkProductCandidate", null);
    __decorate([
        Post('company-details/quote'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "quoteCompanyDetail", null);
    __decorate([
        Post('company-details/refresh-quote'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "quoteCompanyDetailRefresh", null);
    __decorate([
        Post('company-details/execute'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "executeCompanyDetail", null);
    __decorate([
        Post('company-details/status'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "companyDetailStatus", null);
    __decorate([
        Get('company-profiles'),
        __param(0, Req())
    ], CompaniesController.prototype, "companyProfiles", null);
    __decorate([
        Post('company-profiles/list'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "listCompanyProfiles", null);
    __decorate([
        Post('company-profiles/update'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "updateCompanyProfile", null);
    __decorate([
        Post('company-profiles/delete'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "deleteCompanyProfile", null);
    __decorate([
        Post('company-profiles/restore'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "restoreCompanyProfile", null);
    __decorate([
        Post('company-profiles/history'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "companyProfileHistory", null);
    __decorate([
        Post('company-timeline/list'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "listCompanyTimeline", null);
    __decorate([
        Post('company-timeline/create'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "createCompanyTimeline", null);
    __decorate([
        Post('company-timeline/edit'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "editCompanyTimeline", null);
    __decorate([
        Post('company-timeline/delete'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "deleteCompanyTimeline", null);
    __decorate([
        Post('company-attachments/list'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "listCompanyAttachments", null);
    __decorate([
        Post('company-attachments/upload'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "uploadCompanyAttachment", null);
    __decorate([
        Post('company-attachments/download'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "downloadCompanyAttachment", null);
    __decorate([
        Post('company-attachments/delete'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "deleteCompanyAttachment", null);
    __decorate([
        Post('company-attachments/clean-expired'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "cleanExpiredCompanyAttachment", null);
    __decorate([
        Post('company-contacts/quote'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "quoteCompanyContacts", null);
    __decorate([
        Post('company-contacts/refresh-quote'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "quoteCompanyContactsRefresh", null);
    __decorate([
        Post('company-contacts/execute'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "executeCompanyContacts", null);
    __decorate([
        Post('company-contacts/profile'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "profileContacts", null);
    __decorate([
        Post('company-contacts/confirm-ownership'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "confirmContactOwnership", null);
    __decorate([
        Post('company-contacts/unsubscribed'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "markContactUnsubscribed", null);
    __decorate([
        Post('company-contacts/final-failure'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "finalCompanyContactsFailure", null);
    __decorate([
        Get('company-contacts/reconciliations'),
        __param(0, Req())
    ], CompaniesController.prototype, "contactReconciliations", null);
    __decorate([
        Post('company-contacts/reconciliations'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "reconcileCompanyContacts", null);
    __decorate([
        Post('company-contacts/late-results'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "recordLateCompanyContacts", null);
    __decorate([
        Post('company-details/final-failure'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "finalCompanyDetailFailure", null);
    __decorate([
        Get('company-details/reconciliations'),
        __param(0, Req())
    ], CompaniesController.prototype, "detailReconciliations", null);
    __decorate([
        Post('company-details/reconciliations'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "reconcileCompanyDetail", null);
    __decorate([
        Post('company-details/late-results'),
        HttpCode(200),
        __param(0, Req())
    ], CompaniesController.prototype, "recordLateCompanyDetail", null);
    CompaniesController = __decorate([
        Controller('api')
    ], CompaniesController);
    return CompaniesController;
}
//# sourceMappingURL=controller.js.map