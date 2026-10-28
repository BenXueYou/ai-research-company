export interface TerminalUsage {
  role: 'terminal';
  accounts: { balance: string; queryFrozen: string }[];
  ledger: Record<string, string>[];
}

export async function readTerminalUsage(request: (path: string) => Promise<unknown>): Promise<TerminalUsage> {
  const data = await request('reports') as TerminalUsage;
  if (!data || data.role !== 'terminal' || !Array.isArray(data.accounts) || !Array.isArray(data.ledger))
    throw new Error('用量数据不完整，请刷新重试');
  return data;
}
