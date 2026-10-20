/**
 * Map Server Utilities (server-only)
 *
 * Resolves map provider tokens from env vars or app_settings.
 * Separated from map-utils.ts to avoid pulling server-only deps into client bundles.
 */

import { getAppSettingValue } from '@/lib/repositories/appSettingsRepository';
import type { MapProvider } from '@/types';

/** Resolve Mapbox access token from env var or app_settings */
export async function getMapboxAccessToken(): Promise<string | null> {
  if(process.env.COURSEY_PLATFORM === 'true') return null;
  const envToken = process.env.MAPBOX_ACCESS_TOKEN;
  if (envToken) return envToken;

  const appToken = await getAppSettingValue<string>('mapbox', 'access_token').catch(() => null);
  return appToken || null;
}

/** Resolve Google Maps Embed API key from env var or app_settings */
export async function getGoogleMapsEmbedApiKey(): Promise<string | null> {
  if(process.env.COURSEY_PLATFORM === 'true') return null;
  const envKey = process.env.GOOGLE_MAPS_EMBED_API_KEY;
  if (envKey) return envKey;

  const appKey = await getAppSettingValue<string>('google-maps-embed', 'api_key').catch(() => null);
  return appKey || null;
}

/** Resolve token for a given map provider */
export async function getMapProviderToken(provider: MapProvider): Promise<string | null> {
  return provider === 'google' ? getGoogleMapsEmbedApiKey() : getMapboxAccessToken();
}
