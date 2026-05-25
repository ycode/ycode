import { NextRequest, NextResponse } from 'next/server';
import { invalidateTimeDependentPages } from '@/lib/services/cacheService';
import { getSettingByKey } from '@/lib/repositories/settingsRepository';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /api/cron/revalidate-date-presets
 *
 * Hourly cron that purges the `time-dependent-pages` cache tag exactly once
 * per local day, so cached pages using `$today`/`$this_week`/etc. presets
 * actually roll over.
 *
 * The cron is scheduled hourly but only does work when the site's configured
 * timezone is at the midnight hour — that way published pages get one
 * invalidation per day regardless of which TZ the user lives in.
 *
 * Secured via CRON_SECRET or Vercel's Authorization header.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const timezone = ((await getSettingByKey('timezone')) as string | null) || 'UTC';
    const currentHour = getHourInTimezone(timezone);

    // Skip silently outside the midnight hour. Returning OK keeps Vercel's
    // cron monitor green; the next hour will retry the check.
    if (currentHour !== 0) {
      return NextResponse.json({ data: { skipped: true, timezone, hour: currentHour } });
    }

    const ok = await invalidateTimeDependentPages();
    return NextResponse.json({ data: { invalidated: ok, timezone, hour: currentHour } });
  } catch (error) {
    console.error('[Cron] Date-preset revalidation error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to revalidate date-preset pages' },
      { status: 500 },
    );
  }
}

/**
 * Returns the current hour (0-23) in the given IANA timezone. Falls back to
 * the UTC hour if the timezone string is invalid (e.g. typo in the setting).
 */
function getHourInTimezone(timezone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      hour: 'numeric',
      hour12: false,
    });
    const parts = formatter.formatToParts(new Date());
    const hourPart = parts.find(p => p.type === 'hour');
    if (!hourPart) return new Date().getUTCHours();
    const parsed = parseInt(hourPart.value, 10);
    // Intl returns '24' for midnight in some locales; normalize to 0.
    return Number.isNaN(parsed) ? new Date().getUTCHours() : parsed % 24;
  } catch {
    return new Date().getUTCHours();
  }
}
