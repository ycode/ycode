import { NextRequest, NextResponse } from 'next/server';

import { getPublishedGeneratedCss } from '@/lib/repositories/pageLayersRepository';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';
import { getPageCssHash, isPageCssHash } from '@/lib/page-css';
import { isValidUUID } from '@/lib/utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const IMMUTABLE_CACHE = 'public, max-age=31536000, s-maxage=31536000, immutable';
const STALE_HASH_CACHE = 'public, max-age=60, s-maxage=60';

/**
 * GET /api/page-css/{pageId}/{hash}.css
 *
 * Serves a published page's compiled CSS, linked by PageRenderer instead of
 * inlining large stylesheets. The URL is content-addressed, so a match is
 * cached forever. When the hash is stale (HTML cached from before a publish),
 * the current CSS is still returned, briefly cached, so that page never
 * renders unstyled.
 *
 * Public: `/api/*` is outside the builder auth gate. In cloud, the tenant comes
 * from the hostname via `x-tenant-id`, which `getSupabaseAdmin()` reads.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pageId: string; file: string }> }
) {
  const { pageId, file } = await params;
  const hash = file.endsWith('.css') ? file.slice(0, -4) : '';

  if (!isValidUUID(pageId) || !isPageCssHash(hash)) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const pageCss = await getPublishedGeneratedCss(pageId);
    if (pageCss && getPageCssHash(pageCss) === hash) {
      return cssResponse(pageCss, IMMUTABLE_CACHE);
    }

    // Pages without their own CSS (and error pages) render the site-wide bundle
    const siteCss: string | null = await getSettingByKey('published_css');
    if (siteCss && getPageCssHash(siteCss) === hash) {
      return cssResponse(siteCss, IMMUTABLE_CACHE);
    }

    const currentCss = pageCss || siteCss;
    if (!currentCss) {
      return new NextResponse('Not found', { status: 404 });
    }

    return cssResponse(currentCss, STALE_HASH_CACHE);
  } catch (error) {
    console.error('[page-css] Failed to load CSS:', error);
    return new NextResponse('Failed to load CSS', {
      status: 500,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}

function cssResponse(css: string, cacheControl: string): NextResponse {
  return new NextResponse(css, {
    status: 200,
    headers: {
      'Content-Type': 'text/css; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}
