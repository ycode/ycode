import crypto from 'crypto';

/**
 * Published pages inline stylesheets up to this size. Larger ones are served
 * from `/api/page-css` instead: an inline stylesheet is repeated in every HTML
 * response (and again in the RSC payload), while a linked one is downloaded
 * once and cached by browsers and the CDN.
 */
export const INLINE_PAGE_CSS_MAX_BYTES = 8 * 1024;

const PAGE_CSS_HASH_LENGTH = 16;
const PAGE_CSS_HASH_PATTERN = /^[a-f0-9]{16}$/;

export function getPageCssHash(css: string): string {
  return crypto.createHash('sha256').update(css).digest('hex').slice(0, PAGE_CSS_HASH_LENGTH);
}

export function isPageCssHash(value: string): boolean {
  return PAGE_CSS_HASH_PATTERN.test(value);
}

/**
 * Content-addressed URL for a published page's stylesheet. The hash changes
 * whenever the CSS does, so the response can be cached forever.
 */
export function getPageCssUrl(pageId: string, css: string): string {
  return `/api/page-css/${pageId}/${getPageCssHash(css)}.css`;
}

export function shouldLinkPageCss(css: string): boolean {
  return Buffer.byteLength(css, 'utf8') > INLINE_PAGE_CSS_MAX_BYTES;
}
