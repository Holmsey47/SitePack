import { rpcErrorCode, type RpcErrorLike } from '@/data/repo';

export type ApiErrorKind = 'network' | 'http' | 'business';

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly code?: string;
  readonly detail?: string;

  constructor(input: { kind: ApiErrorKind; message: string; status?: number; code?: string; detail?: string }) {
    super(input.message);
    this.name = 'ApiError';
    this.kind = input.kind;
    this.status = input.status;
    this.code = input.code;
    this.detail = input.detail;
  }
}

const NETWORK_MESSAGES = new Set([
  'Failed to fetch',
  'Network request failed',
  'TypeError: Failed to fetch',
  'TypeError: Network request failed',
  'timeout',
  'network',
]);

export function isNetworkMessage(message: string): boolean {
  return NETWORK_MESSAGES.has(message.trim());
}

/**
 * supabase-js reports a failed fetch as status 0 and message "TypeError: Failed to fetch"
 * on web, or "TypeError: Network request failed" on React Native. A Postgres raise comes
 * back as a business code, with the site name in DETAIL. HTTP status is kept on the error.
 */
export function apiErrorFromTransport(error: RpcErrorLike, status?: number): ApiError {
  const mapped = rpcErrorCode(error);
  if (mapped !== 'unknown') {
    const detail = typeof error.details === 'string' && error.details.trim() ? error.details : undefined;
    return new ApiError({ kind: 'business', code: mapped, message: mapped, detail, status });
  }
  const message = (error.message ?? '').trim() || 'unknown';
  if (status === 0 || isNetworkMessage(message)) {
    return new ApiError({ kind: 'network', message, status });
  }
  return new ApiError({ kind: 'http', message, status });
}
