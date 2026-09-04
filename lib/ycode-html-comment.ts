/**
 * HTML source stamps that identify a page as built with Ycode.
 * Mirrors Framer / Webflow: comments sit after `<!DOCTYPE html>` and
 * before `<html>`.
 */

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export const MADE_IN_YCODE_COMMENT = 'Made in Ycode · ycode.com';

/** Strip sequences that would terminate an HTML comment. */
function escapeHtmlComment(text: string): string {
  return text.replace(/--+/g, '-');
}

/**
 * Format a timestamp the way Framer does:
 * `Sep 4, 2026, 10:49 AM UTC`
 */
export function formatYcodePublishedCommentDate(date: Date): string {
  const month = MONTHS[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  const hour24 = date.getUTCHours();
  const ampm = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 || 12;
  return `${month} ${day}, ${year}, ${hour12}:${minutes} ${ampm} UTC`;
}

function parsePublishedAt(publishedAt?: string | Date | null): Date | null {
  if (!publishedAt) return null;
  const date = publishedAt instanceof Date ? publishedAt : new Date(publishedAt);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Build the HTML comment block written into published / exported documents.
 * Always includes the Made-in line; adds Published when a valid timestamp exists.
 */
export function buildYcodeHtmlComments(publishedAt?: string | Date | null): string {
  const lines = [`<!-- ${escapeHtmlComment(MADE_IN_YCODE_COMMENT)} -->`];
  const date = parsePublishedAt(publishedAt);
  if (date) {
    lines.push(`<!-- Published ${escapeHtmlComment(formatYcodePublishedCommentDate(date))} -->`);
  }
  return lines.join('\n');
}

const DOCTYPE = /<!DOCTYPE html>/i;
const HTML_OPEN_TAG = /<html\b[^>]*>/i;

/**
 * Insert the Ycode comments after `<!DOCTYPE html>` and before `<html>`.
 * Idempotent when the Made-in line is already at the top of the document.
 */
export function insertYcodeHtmlComments(
  html: string,
  publishedAt?: string | Date | null,
): string {
  if (html.slice(0, 500).includes(MADE_IN_YCODE_COMMENT)) {
    return html;
  }

  const comments = buildYcodeHtmlComments(publishedAt);
  const doctype = DOCTYPE.exec(html);
  if (doctype && doctype.index !== undefined) {
    const afterDoctype = doctype.index + doctype[0].length;
    const rest = html.slice(afterDoctype).replace(/^\s*/, '');
    return `${html.slice(0, doctype.index)}<!DOCTYPE html>\n${comments}\n${rest}`;
  }

  const htmlTag = HTML_OPEN_TAG.exec(html);
  if (htmlTag && htmlTag.index !== undefined) {
    return `${html.slice(0, htmlTag.index)}${comments}\n${html.slice(htmlTag.index)}`;
  }

  return html;
}

/**
 * Shared across the instrumentation bundle and the app bundle (they are
 * separate module instances). Same pattern as the Supabase admin client.
 */
const globalForStamp = globalThis as typeof globalThis & {
  __ycodePublishedAt?: string | Date | null;
};

const PUBLISHED_AT_TTL_MS = 30_000;
let publishedAtFetchedAt = 0;

export function rememberYcodePublishedAt(publishedAt: string | Date | null | undefined): void {
  globalForStamp.__ycodePublishedAt = publishedAt ?? null;
}

/** Load `published_at` before the HTML stream starts so the Published line is present. */
export async function prefetchYcodePublishedAt(): Promise<void> {
  if (
    Date.now() - publishedAtFetchedAt < PUBLISHED_AT_TTL_MS
    && globalForStamp.__ycodePublishedAt !== undefined
  ) {
    return;
  }

  try {
    const { getSettingByKey } = await import('@/lib/repositories/settingsRepository');
    const value = await getSettingByKey('published_at');
    rememberYcodePublishedAt(typeof value === 'string' ? value : null);
  } catch {
    rememberYcodePublishedAt(null);
  }
  publishedAtFetchedAt = Date.now();
}

export function runWithYcodeStamp<T>(publishedAt: string | Date | null | undefined, fn: () => T): T {
  rememberYcodePublishedAt(publishedAt);
  return fn();
}

export function stampHtmlDocument(html: string): string {
  return insertYcodeHtmlComments(html, globalForStamp.__ycodePublishedAt);
}
