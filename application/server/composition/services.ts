import type pg from 'pg';
import { IdentityService } from '../identity/identity.js';
import { bindContactKey, contactKey, OrganizationService } from '../organizations/organizations.js';
import { ProcurementService } from '../commerce/procurement.js';
import { CoefficientService } from '../commerce/coefficient.js';
import { PointOrderService } from '../commerce/orders.js';
import { ReportingService } from '../commerce/reporting.js';
import { MemberService } from '../identity/members.js';
import { PasswordResetService } from '../identity/password-resets.js';
import { CompanySearchService } from '../companies/company-search.js';
import { ProductSearchService, type ImporterNameClient } from '../companies/product-search.js';
import { CompanyDetailService, type CompanyDetailClient } from '../companies/company-detail.js';
import { CompanyProfileService } from '../companies/company-profiles.js';
import { CompanyTimelineService } from '../companies/company-timeline.js';
import { CompanyAttachmentService } from '../companies/company-attachments.js';
import { DetailReconciliationService } from '../companies/detail-reconciliation.js';
import { ContactReconciliationService } from '../companies/contact-reconciliation.js';
import { ProductReconciliationService } from '../companies/product-reconciliation.js';
import { CompanyContactService, type CompanyContactClient } from '../companies/company-contacts.js';
import { EmailPreviewService } from '../email/email-preview.js';
import { EmailSendService, type DeliveryEvidenceProvider, type DomesticSmtpSender, type UMailSender } from '../email/email-send.js';
import type { TengdaoCompanyClient } from '../upstream/tengdao.js';
import { UpstreamMonitorService, type UpstreamAccountClient } from '../upstream/upstream-monitor.js';
import {
  bindSmtpCredentialKey,
  type DomesticSmtpAdapter,
  smtpCredentialKey,
  SmtpChannelService
} from '../email/smtp-channel.js';
import {
  type UMailAdapter,
  UMailService
} from '../email/umail.js';


export async function createServices(
  pool: pg.Pool,
  production: boolean,
  smtpAdapter: DomesticSmtpAdapter,
  tengdao: TengdaoCompanyClient,
  umailAdapter: UMailAdapter,
  detailAdapter: CompanyDetailClient,
  accountClient: UpstreamAccountClient | undefined,
  contactAdapter: CompanyContactClient,
  importerAdapter: ImporterNameClient | undefined,
  smtpSender: DomesticSmtpSender | undefined,
  umailSender: UMailSender | undefined,
  evidenceProvider: DeliveryEvidenceProvider | undefined
) {
  const service = new IdentityService(pool);
  const key = contactKey();
  await bindContactKey(pool, key);
  const organizations = new OrganizationService(pool, key);
  const procurement = new ProcurementService(pool, production);
  const coefficient = new CoefficientService(pool, accountClient);
  const pointOrders = new PointOrderService(pool);
  const reporting = new ReportingService(pool);
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
  return {
    service, organizations, procurement, coefficient, pointOrders, reporting,
    members, passwordResets, companySearch, productSearch, companyDetail,
    companyProfiles, companyTimeline, companyAttachments, detailReconciliation,
    contactReconciliation, productReconciliation, companyContacts, emailPreview,
    upstreamMonitor, smtpChannels, emailSend, umail
  };
}
export type Services = Awaited<ReturnType<typeof createServices>>;
