import type { CompanyRequest } from './companyProfiles';

export type ProfileImportSourceKind = 'company_candidate' | 'product_candidate';
export interface ProfileImportResult {
  sourceKind: ProfileImportSourceKind;
  sourceRecordId: string;
  decision: 'create';
  status: 'created' | 'linked' | 'rejected';
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
