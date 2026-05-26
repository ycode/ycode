import { NextResponse } from 'next/server';
import { getAllDraftPages } from '@/lib/repositories/pageRepository';
import { getAllDraftLayers } from '@/lib/repositories/pageLayersRepository';
import { getAllPageFolders } from '@/lib/repositories/pageFolderRepository';
import { getAllComponents } from '@/lib/repositories/componentRepository';
import { getAllStyles } from '@/lib/repositories/layerStyleRepository';
import { getAllSettings } from '@/lib/repositories/settingsRepository';
import { getAllCollections } from '@/lib/repositories/collectionRepository';
import { getAllLocales } from '@/lib/repositories/localeRepository';
import { getAllAssets } from '@/lib/repositories/assetRepository';
import { getAllAssetFolders } from '@/lib/repositories/assetFolderRepository';
import { getAllFonts } from '@/lib/repositories/fontRepository';
import { getMapboxAccessToken, getGoogleMapsEmbedApiKey } from '@/lib/map-server';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * GET /ycode/api/editor/init
 * Get all initial data for the editor in one request:
 * - All draft (non-published) pages
 * - All draft layers
 * - All page folders
 * - All components
 * - All layer styles
 * - All settings
 * - All collections
 * - All locales
 * - All assets
 * - All asset folders
 * - All fonts
 */
export async function GET() {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    // Load all data in parallel (only drafts for editor)
    const [pages, drafts, folders, components, styles, settings, collections, locales, assets, assetFolders, fonts, resolvedMapboxToken, resolvedGoogleMapsEmbedKey] = await Promise.all([
      getAllDraftPages(),
      getAllDraftLayers(),
      getAllPageFolders({ is_published: false }),
      getAllComponents(),
      getAllStyles(),
      getAllSettings(),
      getAllCollections(),
      getAllLocales(),
      getAllAssets(),
      getAllAssetFolders(false),
      getAllFonts(),
      getMapboxAccessToken(),
      getGoogleMapsEmbedApiKey(),
    ]);

    // Inject app-sourced tokens into settings so they're available via settingsByKey
    const enrichedSettings = [...settings];
    const injectedTokens: [string, string, string | null][] = [
      ['app:mapbox:access_token', 'mapbox_access_token', resolvedMapboxToken],
      ['app:google-maps-embed:api_key', 'google_maps_embed_api_key', resolvedGoogleMapsEmbedKey],
    ];
    for (const [id, key, value] of injectedTokens) {
      if (value) {
        enrichedSettings.push({
          id,
          key,
          value,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      }
    }

    return NextResponse.json({
      data: {
        pages,
        drafts,
        folders,
        components,
        styles,
        settings: enrichedSettings,
        collections,
        locales,
        assets,
        assetFolders,
        fonts,
      },
    });
  } catch (error) {
    console.error('Error loading editor data:', error);
    return NextResponse.json(
      { error: 'Failed to load editor data' },
      { status: 500 }
    );
  }
}
