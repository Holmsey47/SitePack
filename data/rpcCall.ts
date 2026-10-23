import type { SupabaseClient } from '@supabase/supabase-js';
import { SnagRequestError, snagRpcError } from '@/data/snagFailure';

/**
 * postgrest-js puts the HTTP status on the response (`{ data, error, status }`),
 * not on `error`. Copy it onto the typed error or a 503/502 is just a message.
 */
function errorWithResponseStatus(
  error: { message: string; details?: string | null; hint?: string | null; code?: string | null },
  status: number
) {
  return {
    message: error.message,
    details: error.details,
    hint: error.hint,
    code: error.code,
    status,
  };
}

export async function rpcCall<T>(
  client: SupabaseClient,
  name: string,
  args: Record<string, unknown>,
  fallback?: string
): Promise<T> {
  const { data, error, status } = await client.rpc(name, args);
  if (error) throw snagRpcError(errorWithResponseStatus(error, status));
  if (data == null) throw new SnagRequestError({ kind: 'business', code: fallback ?? 'not_found' });
  return data as T;
}

/** Same status handling as {@link rpcCall}. A null payload is an empty result, not an error. */
export async function rpcCallOrNull<T>(client: SupabaseClient, name: string, args: Record<string, unknown>): Promise<T | null> {
  const { data, error, status } = await client.rpc(name, args);
  if (error) throw snagRpcError(errorWithResponseStatus(error, status));
  if (data == null) return null;
  return data as T;
}
