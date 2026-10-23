export type CompanyMark = {
  name: string;
  logoUrl: string | null;
};

/** 1 MiB. The company-logos bucket uses the same cap. */
export const LOGO_MAX_BYTES = 1_048_576;

/** Longest side after the picker resizes a logo. */
export const LOGO_MAX_EDGE = 512;

const LOGO_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export type LogoContentType = keyof typeof LOGO_TYPES;
export type LogoExtension = (typeof LOGO_TYPES)[LogoContentType];

const PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;

export function logoExtension(contentType: string): LogoExtension | null {
  return LOGO_TYPES[contentType as LogoContentType] ?? null;
}

/**
 * JPEG, PNG, and WebP only, between 1 byte and 1 MiB.
 * The picker turns a chosen photo into a JPEG before this runs.
 */
export function assertLogoUpload(bytes: Uint8Array, contentType: string): LogoExtension {
  const extension = logoExtension(contentType);
  if (!extension) throw new Error('invalid_input');
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 1) throw new Error('invalid_input');
  if (bytes.byteLength > LOGO_MAX_BYTES) throw new Error('photo_too_large');
  return extension;
}

/** company-logos object name: <company_id>/<file_id>.<ext>. The bucket name is not part of the path. */
export function logoObjectPath(companyId: string, fileId: string, extension: LogoExtension): string {
  const path = `${companyId}/${fileId}.${extension}`;
  if (!PATH.test(path) || !path.startsWith(`${companyId}/`)) throw new Error('invalid_input');
  return path;
}

export function logoFailureMessage(code: string): string {
  if (code === 'not_authorized') return 'Only the owner can change the logo.';
  if (code === 'photo_too_large' || code === 'invalid_input') return 'Use a JPEG, PNG, or WebP under 1MB.';
  return 'Could not save the logo.';
}
