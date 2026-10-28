import axios, { AxiosError } from 'axios';

const service = axios.create({
  baseURL: '/api/',
  withCredentials: true
});

export class HttpError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

function csrfToken(): string {
  return document.cookie.split('; ').find(item =>
    item.startsWith('identity_csrf=')
  )?.slice(14) ?? '';
}

export async function apiRequest(path: string, body?: Record<string, unknown>): Promise<unknown> {
  try {
    const response = await service.request<unknown>({
      url: path,
      method: body ? 'POST' : 'GET',
      headers: body ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() } : undefined,
      data: body
    });
    return response.data;
  } catch (failure) {
    if (!(failure instanceof AxiosError)) throw failure;
    if (!failure.response) throw new TypeError(failure.message);
    const data: unknown = failure.response.data;
    const message = typeof data === 'object' && data !== null && 'message' in data &&
      typeof data.message === 'string' ? data.message : '请求失败，请稍后重试';
    throw new HttpError(message, failure.response.status);
  }
}
