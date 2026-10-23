import { rpcErrorCode, type RpcErrorLike } from '@/data/repo';

/** How a queued snag send failed. Network and HTTP retry; a business code does not. */
export type SnagFailure =
  | { kind: 'network'; message: string }
  | { kind: 'http'; status: number; message: string }
  | { kind: 'business'; code: string };

export class SnagRequestError extends Error {
  readonly failure: SnagFailure;

  constructor(failure: SnagFailure) {
    super(failure.kind === 'business' ? failure.code : failure.message);
    this.name = 'SnagRequestError';
    this.failure = failure;
  }
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return '';
}

function httpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const record = err as { status?: unknown; statusCode?: unknown };
  if (typeof record.status === 'number' && Number.isFinite(record.status)) return record.status;
  if (typeof record.statusCode === 'number' && Number.isFinite(record.statusCode)) return record.statusCode;
  if (typeof record.statusCode === 'string' && /^\d{3}$/.test(record.statusCode)) return Number(record.statusCode);
  return undefined;
}

function isNetworkMessage(message: string): boolean {
  return (
    message === 'network' ||
    message === 'timeout' ||
    /failed to fetch/i.test(message) ||
    /network request failed/i.test(message) ||
    /\btimeout\b/i.test(message) ||
    /network error/i.test(message)
  );
}

/** Read a Supabase, storage, or thrown error without dropping its status. */
export function snagFailureFrom(err: unknown): SnagFailure {
  if (err instanceof SnagRequestError) return err.failure;
  const message = messageOf(err);
  if (err instanceof TypeError || isNetworkMessage(message)) return { kind: 'network', message: message || 'network' };
  const statusFromMessage = /^(?:4|5)\d\d$/.test(message) ? Number(message) : undefined;
  const status = httpStatus(err) ?? statusFromMessage;
  const like: RpcErrorLike | string =
    err && typeof err === 'object' ? (err as RpcErrorLike) : message;
  const code = rpcErrorCode(like);
  if (code !== 'unknown') return { kind: 'business', code };
  if (message === 'unknown') return { kind: 'network', message: 'unknown' };
  if (status === 408 || status === 429 || (status !== undefined && status >= 500 && status <= 599)) {
    return { kind: 'http', status, message: message || String(status) };
  }
  if (status !== undefined && status >= 400 && status <= 499) {
    return { kind: 'http', status, message: message || String(status) };
  }
  return { kind: 'business', code: message || 'unknown' };
}

export function isRetryableSnagFailure(err: unknown): boolean {
  const failure = snagFailureFrom(err);
  if (failure.kind === 'network') return true;
  if (failure.kind === 'http') {
    return failure.status === 401 || failure.status === 408 || failure.status === 429 || (failure.status >= 500 && failure.status <= 599);
  }
  return false;
}

export function snagFailureCode(err: unknown): string {
  const failure = snagFailureFrom(err);
  if (failure.kind === 'business') return failure.code;
  if (failure.kind === 'http') return String(failure.status);
  return failure.message;
}

/**
 * postgrest-js keeps the HTTP status on the response (`{ data, error, status }`),
 * not on `error`. Copy it onto the failure so a 503 is not read as a business code.
 */
function attachStatus(error: unknown, status?: number): unknown {
  if (typeof status !== 'number' || !Number.isFinite(status)) return error;
  const record =
    error && typeof error === 'object'
      ? (error as { details?: string | null; hint?: string | null; code?: string | null })
      : {};
  return {
    message: messageOf(error) || String(status),
    details: record.details ?? null,
    hint: record.hint ?? null,
    code: record.code ?? null,
    status,
  };
}

/** The error unwrap throws for an RPC failure. `status` is the HTTP status from the response. */
export function snagRpcError(error: unknown, status?: number): SnagRequestError {
  return new SnagRequestError(snagFailureFrom(attachStatus(error, status)));
}

/** Throw the typed snag failure for a PostgREST response, using `response.status`. */
export function throwSnagRpc<T>(
  response: { data: T | null; error: unknown; status?: number },
  fallback?: string
): T {
  const status = response.status;
  if (response.error || (typeof status === 'number' && status >= 400)) {
    throw snagRpcError(response.error ?? { message: typeof status === 'number' ? String(status) : 'unknown' }, status);
  }
  if (response.data == null) throw new Error(fallback ?? 'not_found');
  return response.data;
}

/**
 * Storage upload has no business code when the phone loses the network.
 * `unknown` stays queued so the photo is sent again. A real code or a 4xx does not.
 */
export function snagStorageError(error: unknown): SnagRequestError {
  const failure = snagFailureFrom(error);
  if (failure.kind === 'business' && failure.code === 'unknown') return new SnagRequestError({ kind: 'network', message: 'unknown' });
  return new SnagRequestError(failure);
}
