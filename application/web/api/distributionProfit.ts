export type ReportRow = Record<string, string>;
export interface DistributionReport {
  role: 'distributor';
  organizations: { id: string; name: string; kind: string; active: boolean }[];
  accounts: ReportRow[];
  ledger: ReportRow[];
  sales: ReportRow[];
  transactions: ReportRow[];
  usage: ReportRow[];
  emailUsage: ReportRow[];
  grossProfit?: string;
}

export async function readDistributionProfit(request: (path: string) => Promise<unknown>) {
  const result = await request('reports') as DistributionReport;
  if (result.role !== 'distributor') throw new Error('报表身份不匹配，请重新登录');
  return result;
}
