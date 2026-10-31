import type { CompanyRequest } from './companyProfiles';

export type ProfileImportSourceKind = 'company_candidate' | 'product_candidate';
export interface ProfileImportResult {
  sourceKind: ProfileImportSourceKind;
  sourceRecordId: string;
  decision: 'create' | 'link';
  status: 'created' | 'linked' | 'rejected' | 'needs_resolution';
  candidates?: Array<{ profileId: string; name: string; countryCode3: string | null }>;
  profileId?: string;
  reasonCode?: string;
}
export interface ProfileImportResponse {
  requestId: string;
  items: ProfileImportResult[];
}

export function importCompanyProfiles(
  request: CompanyRequest,
  requestId: string,
  sourceKind: ProfileImportSourceKind,
  sourceRecordIds: string[]
) {
  return request('company-profile-imports', {
    requestId,
    items: sourceRecordIds.map(sourceRecordId =>
      ({ sourceKind, sourceRecordId, decision: 'create' })
    )
  }) as Promise<ProfileImportResponse>;
}

export function resolveProfileImport(
  request: CompanyRequest, requestId: string, sourceKind: ProfileImportSourceKind,
  sourceRecordId: string, choice: string
) {
  const item = choice === 'new'
    ? { sourceKind, sourceRecordId, decision: 'create' }
    : { sourceKind, sourceRecordId, decision: 'link', profileId: choice };
  return request('company-profile-import-resolutions', { requestId, items: [item] }) as Promise<ProfileImportResponse>;
}
