export const INVITE_CLIENT_CODES = [
  'not_authorized',
  'invalid_input',
  'person_not_found',
  'already_member',
  'invite_failed',
  'invite_redirect_not_configured',
] as const;

export type InviteClientCode = (typeof INVITE_CLIENT_CODES)[number];

export type InviteFailureKind = 'auth' | 'person' | 'assignment' | 'unexpected';

export type MappedInviteFailure = {
  code: InviteClientCode;
  status: number;
};

type ErrorBits = {
  message: string;
  code: string;
};

function bits(error: unknown): ErrorBits {
  if (!error || typeof error !== 'object') {
    return { message: error instanceof Error ? error.message : '', code: '' };
  }
  const record = error as { message?: unknown; code?: unknown; details?: unknown };
  const message = [record.message, record.details]
    .filter((part) => typeof part === 'string')
    .join('\n');
  const code = typeof record.code === 'string' ? record.code : '';
  return { message, code };
}

/**
 * Map a GoTrue or Postgres error to a fixed code. The raw message stays in the
 * server log. It is not part of this return value.
 */
export function mapInviteFailure(error: unknown, kind: InviteFailureKind): MappedInviteFailure {
  const { message, code } = bits(error);
  const already =
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    code === '23505' ||
    /already (been )?registered|already exists|duplicate key|unique constraint/i.test(message);

  if (kind === 'unexpected') {
    if (error instanceof SyntaxError || /unexpected token|json/i.test(message)) {
      return { code: 'invalid_input', status: 400 };
    }
    if (code === '42501' || /not_authorized|permission denied/i.test(message)) {
      return { code: 'not_authorized', status: 403 };
    }
    return { code: 'invite_failed', status: 500 };
  }

  if (already) return { code: 'already_member', status: 409 };

  if (kind === 'assignment' && (code === '23503' || /foreign key/i.test(message))) {
    return { code: 'person_not_found', status: 404 };
  }

  if (
    code === '23514' ||
    code === '23502' ||
    code === '22P02' ||
    /invalid format|unable to validate email|check constraint|invalid input/i.test(message)
  ) {
    return { code: 'invalid_input', status: 400 };
  }

  if (code === '42501' || /not_authorized|permission denied|jwt/i.test(message)) {
    return { code: 'not_authorized', status: 403 };
  }

  return { code: 'invite_failed', status: kind === 'unexpected' ? 500 : 400 };
}
