/**
 * Parse a public-site pathname into the lookup key used to load that page's
 * custom <head> code (preview vs published, error page, slug path).
 */
export interface PageHeadPath {
  isPreview: boolean;
  errorCode: number | null;
  /** Slug path without a leading slash. Empty string is the homepage. */
  slugPath: string;
}

const PREVIEW_PREFIX = '/ycode/preview';
const PREVIEW_ERROR_PREFIX = '/ycode/preview/error-pages/';

export function parsePathnameForPageHead(pathname: string): PageHeadPath {
  if (pathname.startsWith(PREVIEW_ERROR_PREFIX)) {
    const raw = pathname.slice(PREVIEW_ERROR_PREFIX.length).split('/')[0];
    const errorCode = Number.parseInt(raw, 10);
    return {
      isPreview: true,
      errorCode: Number.isFinite(errorCode) ? errorCode : null,
      slugPath: '',
    };
  }

  if (pathname === PREVIEW_PREFIX || pathname.startsWith(`${PREVIEW_PREFIX}/`)) {
    const slugPath = pathname === PREVIEW_PREFIX
      ? ''
      : pathname.slice(PREVIEW_PREFIX.length + 1);
    return { isPreview: true, errorCode: null, slugPath };
  }

  const slugPath = pathname === '/' ? '' : pathname.replace(/^\//, '');
  return { isPreview: false, errorCode: null, slugPath };
}
