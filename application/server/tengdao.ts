import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { createClient } from 'redis';
import type { CompanyDetailClient, DetailResult } from './company-detail.js';
import type { CompanyContactClient, ContactPageResult } from './company-contacts.js';
type RedisClient = ReturnType<typeof createClient>;

export interface CompanyListRequestDto {
  name: string;
  countryCodes: string;
  pageNo: number;
  pageSize: number;
}
export interface CompanyListItemDto { id: string; name: string; country: string }
export interface CompanyListResponseDto {
  data: { content: CompanyListItemDto[]; page: number; size: number; total: number } | null;
  traceId?: string;
  code: string | number;
  success: boolean;
  msg?: string;
}
interface AccessTokenResponseDto {
  data: { accessToken: string; expiresIn: number; unit: 'SECONDS' | 'MINUTES' | 'HOURS' } | null;
  traceId?: string;
  code: string | number;
  success: boolean;
}
export interface TengdaoCompanyPage {
  content: CompanyListItemDto[];
  page: number;
  size: number;
  total: number;
  traceId?: string;
}
export interface TengdaoCompanyClient { listCompanies(input: CompanyListRequestDto): Promise<TengdaoCompanyPage> }

export interface TengdaoUsage { minute: number; dataToday: number; businessToday: number }
export interface TengdaoSharedState {
  token(): Promise<string | null>;
  cacheToken(token: string, ttlSeconds: number): Promise<void>;
  tryTokenLock(owner: string): Promise<boolean>;
  releaseTokenLock(owner: string): Promise<void>;
  reserve(callClass: 'business' | 'data', dailyLimit: number, now: Date): Promise<void>;
  usage?(now: Date): Promise<TengdaoUsage>;
}

export class RedisTengdaoSharedState implements TengdaoSharedState {
  constructor(private readonly redis: RedisClient, private readonly prefix = 'tengdao:shared') {}
  token() { return this.redis.get(`${this.prefix}:token`); }
  async cacheToken(token: string, ttlSeconds: number) {
    await this.redis.set(`${this.prefix}:token`, token, { EX: Math.max(1, ttlSeconds) });
  }
  async tryTokenLock(owner: string) {
    return (await this.redis.set(`${this.prefix}:token-lock`, owner, { NX: true, PX: 10_000 })) === 'OK';
  }
  async releaseTokenLock(owner: string) {
    await this.redis.eval(`if redis.call('get',KEYS[1])==ARGV[1] then return redis.call('del',KEYS[1]) end return 0`, {
      keys: [`${this.prefix}:token-lock`], arguments: [owner]
    });
  }
  async reserve(callClass: 'business' | 'data', dailyLimit: number, now: Date) {
    const minute = now.toISOString().slice(0, 16);
    const day = now.toISOString().slice(0, 10);
    const outcome = await this.redis.eval(`
      local minute=tonumber(redis.call('get',KEYS[1]) or '0')
      local daily=tonumber(redis.call('get',KEYS[2]) or '0')
      if minute >= tonumber(ARGV[1]) then return 1 end
      if daily >= tonumber(ARGV[2]) then return 2 end
      redis.call('incr',KEYS[1]); redis.call('expire',KEYS[1],120)
      redis.call('incr',KEYS[2]); redis.call('expire',KEYS[2],172800)
      return 0`, {
      keys: [`${this.prefix}:minute:${minute}`, `${this.prefix}:${callClass}:day:${day}`],
      arguments: ['180', String(dailyLimit)]
    });
    if (Number(outcome) === 1) throw new HttpException('腾道共享账号调用频率已达安全上限', HttpStatus.TOO_MANY_REQUESTS);
    if (Number(outcome) === 2) throw new HttpException(callClass === 'data' ? '腾道共享账号今日数据调用次数已用尽' : '腾道共享账号今日业务调用次数已用尽', HttpStatus.TOO_MANY_REQUESTS);
  }
  async usage(now: Date): Promise<TengdaoUsage> {
    const minute = now.toISOString().slice(0, 16);
    const day = now.toISOString().slice(0, 10);
    const values = await this.redis.mGet([
      `${this.prefix}:minute:${minute}`,
      `${this.prefix}:data:day:${day}`,
      `${this.prefix}:business:day:${day}`
    ]);
    return { minute: Number(values[0] ?? 0), dataToday: Number(values[1] ?? 0), businessToday: Number(values[2] ?? 0) };
  }
}

export interface TengdaoClientConfig {
  baseUrl: string;
  apiKey: string;
  businessDailyLimit: number;
  dataDailyLimit?: number;
  fetch?: typeof fetch;
  now?: () => Date;
  randomId?: () => string;
}

function tokenTtl(data: NonNullable<AccessTokenResponseDto['data']>): number {
  const factors = { SECONDS: 1, MINUTES: 60, HOURS: 3600 } as const;
  if (!Number.isFinite(data.expiresIn) || data.expiresIn <= 0 || !(data.unit in factors))
    throw new ServiceUnavailableException('腾道令牌响应无效');
  return Math.max(1, data.expiresIn * factors[data.unit] - 300);
}

export class HttpTengdaoCompanyClient implements TengdaoCompanyClient, CompanyDetailClient, CompanyContactClient {
  private readonly request: typeof fetch;
  private readonly now: () => Date;
  private readonly randomId: () => string;
  constructor(private readonly state: TengdaoSharedState, private readonly config: TengdaoClientConfig) {
    if (!config.baseUrl || !config.apiKey || !Number.isInteger(config.businessDailyLimit) || config.businessDailyLimit <= 0)
      throw new Error('腾道配置不完整');
    this.request = config.fetch ?? fetch;
    this.now = config.now ?? (() => new Date());
    this.randomId = config.randomId ?? (() => crypto.randomUUID());
  }
  async usage(): Promise<TengdaoUsage | null> {
    return this.state.usage?.(this.now()) ?? null;
  }
  limits() {
    return { minute: 180, dataToday: this.config.dataDailyLimit ?? 30_000, businessToday: this.config.businessDailyLimit };
  }
  async account(): Promise<{ balance: string; expiresIn: string; traceId: string | null }> {
    let token = await this.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.state.reserve('business', this.config.businessDailyLimit, this.now());
      const url = new URL('/v2/account', this.config.baseUrl);
      let body: { success: boolean; code: string | number; traceId?: string; data: { balance: string | number; expiresIn: string } | null };
      try {
        const response = await this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
        body = await response.json() as typeof body;
      } catch {
        throw new ServiceUnavailableException('腾道账户状态暂时不可用');
      }
      if (!body.success && String(body.code) === '40302' && attempt === 0) {
        token = await this.accessToken(true);
        continue;
      }
      if (!body.success) throw new ServiceUnavailableException(`腾道账户状态失败（${String(body.code)}）`);
      if (!body.data || !/^\d+(?:\.\d+)?$/.test(String(body.data.balance)) || typeof body.data.expiresIn !== 'string')
        throw new ServiceUnavailableException('腾道账户状态响应无效');
      return { balance: String(body.data.balance), expiresIn: body.data.expiresIn, traceId: body.traceId ?? null };
    }
    throw new ServiceUnavailableException('腾道共享令牌刷新失败');
  }
  private async accessToken(force = false): Promise<string> {
    if (!force) {
      const cached = await this.state.token();
      if (cached) return cached;
    }
    const owner = this.randomId();
    const locked = await this.state.tryTokenLock(owner);
    if (!locked) {
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 50));
        const shared = await this.state.token();
        if (shared) return shared;
      }
      throw new ServiceUnavailableException('腾道共享令牌正在刷新，请稍后重试');
    }
    try {
      if (!force) {
        const shared = await this.state.token();
        if (shared) return shared;
      }
      await this.state.reserve('business', this.config.businessDailyLimit, this.now());
      const url = new URL('/v2/access-token', this.config.baseUrl);
      url.searchParams.set('apiKey', this.config.apiKey);
      const response = await this.request(url, { method: 'GET', signal: AbortSignal.timeout(10_000) });
      const body = await response.json() as AccessTokenResponseDto;
      if (!body.success || !body.data?.accessToken)
        throw new ServiceUnavailableException(`腾道令牌获取失败（${String(body.code)}）`);
      await this.state.cacheToken(body.data.accessToken, tokenTtl(body.data));
      return body.data.accessToken;
    } finally {
      await this.state.releaseTokenLock(owner);
    }
  }
  async listCompanies(input: CompanyListRequestDto): Promise<TengdaoCompanyPage> {
    let token = await this.accessToken();
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.state.reserve('data', this.config.dataDailyLimit ?? 30_000, this.now());
      const url = new URL('/v2/company/list', this.config.baseUrl);
      url.searchParams.set('name', input.name);
      url.searchParams.set('countryCodes', input.countryCodes);
      url.searchParams.set('pageNo', String(input.pageNo));
      url.searchParams.set('pageSize', String(input.pageSize));
      let body: CompanyListResponseDto;
      try {
        const response = await this.request(url, { method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000) });
        body = await response.json() as CompanyListResponseDto;
      } catch {
        throw new ServiceUnavailableException('腾道免费企业查询暂时不可用');
      }
      const code = String(body.code);
      if (!body.success && code === '40302' && attempt === 0) {
        token = await this.accessToken(true);
        continue;
      }
      if (!body.success || !body.data) throw new ServiceUnavailableException(`腾道企业查询失败（${code}）`);
      if (!Array.isArray(body.data.content)) throw new ServiceUnavailableException('腾道企业列表响应结构无效');
      if (![body.data.page, body.data.size, body.data.total].every(value => Number.isInteger(value) && value >= 0))
        throw new ServiceUnavailableException('腾道企业列表分页响应无效');
      const content = body.data.content.map(item => {
        if (!item || typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.country !== 'string')
          throw new ServiceUnavailableException('腾道企业候选响应结构无效');
        return { id: item.id, name: item.name, country: item.country };
      });
      return { content, page: body.data.page, size: body.data.size, total: body.data.total, traceId: body.traceId };
    }
    throw new ServiceUnavailableException('腾道共享令牌刷新失败');
  }
  async detail(input: { name: string; countryCode3: string }): Promise<DetailResult> {
    const token = await this.accessToken();
    await this.state.reserve('data', this.config.dataDailyLimit ?? 30_000, this.now());
    const url = new URL('/v2/company', this.config.baseUrl);
    url.searchParams.set('name', input.name);
    url.searchParams.set('countryCode3', input.countryCode3);
    const response = await this.request(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000)
    });
    const body = await response.json() as { success: boolean; data: Record<string, unknown> | null; traceId?: string };
    if (!body.success || !body.data || !Object.hasOwn(body.data, 'id'))
      throw new ServiceUnavailableException('腾道企业详情结果待核对');
    // The detail response does not establish the actual billed points. Keep the freeze for reconciliation.
    return { data: body.data, traceId: body.traceId };
  }
  async contacts(input: { companyName: string; positionTags: string[]; pageNo: number; pageSize: number }): Promise<ContactPageResult> {
    const token = await this.accessToken();
    await this.state.reserve('data', this.config.dataDailyLimit ?? 30_000, this.now());
    const url = new URL('/v2/contact', this.config.baseUrl);
    url.searchParams.set('companyName', input.companyName);
    url.searchParams.set('positionTag', input.positionTags.join(','));
    url.searchParams.set('pageNo', String(input.pageNo));
    url.searchParams.set('pageSize', String(input.pageSize));
    const response = await this.request(url, {
      method: 'GET', headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15_000)
    });
    const body = await response.json() as { success: boolean; data: ContactPageResult['data']; traceId?: string };
    if (!body.success || !body.data || !Array.isArray(body.data.list))
      throw new ServiceUnavailableException('腾道联系人结果待核对');
    // The response does not prove the actual bill. Keep the freeze for reconciliation.
    return { data: body.data, traceId: body.traceId };
  }
}
