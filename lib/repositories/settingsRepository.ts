/**
 * Settings Repository
 *
 * Data access layer for application settings stored in the database
 */

import { getSupabaseAdmin } from '@/lib/supabase-server';
import { normalizeSitemapSettings } from '@/lib/sitemap-settings';
import type { Setting } from '@/types';

// Postgres "undefined_table" — the settings table is briefly absent right after
// a DB reset and before migrations re-run. Treat it as "no settings" instead of
// crashing page renders.
const UNDEFINED_TABLE = '42P01';

/** True when an error indicates the settings table does not exist yet. */
function isMissingTableError(error: { code?: string } | null): boolean {
  return error?.code === UNDEFINED_TABLE;
}

/**
 * Get all settings
 *
 * @returns Promise resolving to all settings
 */
export async function getAllSettings(): Promise<Setting[]> {
  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('settings')
    .select('*')
    .order('key', { ascending: true });

  if (error) {
    if (isMissingTableError(error)) {
      return [];
    }
    throw new Error(`Failed to fetch settings: ${error.message}`);
  }

  return data || [];
}

/**
 * Get a setting by key
 *
 * @param key - The setting key
 * @param tenantId - Optional tenant scope (ignored in single-tenant deployments)
 * @returns Promise resolving to the setting value or null if not found
 */
export async function getSettingByKey(key: string, tenantId?: string): Promise<any | null> {
  const client = await getSupabaseAdmin(tenantId);
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('settings')
    .select('value')
    .eq('key', key)
    .single();

  if (error) {
    if (error.code === 'PGRST116' || isMissingTableError(error)) {
      // Not found, or table not yet created
      return null;
    }
    throw new Error(`Failed to fetch setting: ${error.message}`);
  }

  return data?.value || null;
}

/**
 * Get multiple settings by keys in a single query
 *
 * @param keys - Array of setting keys to fetch
 * @returns Promise resolving to a map of key -> value
 */
export async function getSettingsByKeys(keys: string[]): Promise<Record<string, any>> {
  if (keys.length === 0) {
    return {};
  }

  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('settings')
    .select('key, value')
    .in('key', keys);

  if (error) {
    if (isMissingTableError(error)) {
      return {};
    }
    throw new Error(`Failed to fetch settings: ${error.message}`);
  }

  const result: Record<string, any> = {};
  for (const setting of data || []) {
    result[setting.key] = setting.value;
  }

  return result;
}

/**
 * Coerce structured settings into their expected shape before they are stored,
 * so a JSON string or partial object can never reach the jsonb column.
 */
function normalizeSettingValue(key: string, value: any): any {
  if (key === 'sitemap') return normalizeSitemapSettings(value);
  return value;
}

/**
 * Set a setting value (insert or update)
 *
 * @param key - The setting key
 * @param value - The value to store
 * @returns Promise resolving to the created/updated setting
 */
export async function setSetting(key: string, value: any): Promise<Setting> {
  value = normalizeSettingValue(key, value);

  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  const { data, error } = await client
    .from('settings')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'key',
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to set setting: ${error.message}`);
  }

  return data;
}

/**
 * Set multiple settings at once (batch upsert)
 * Settings with null/undefined values are deleted instead of upserted.
 *
 * @param settings - Object with key-value pairs to store
 * @returns Promise resolving to the number of settings updated
 */
export async function setSettings(settings: Record<string, any>): Promise<number> {
  const entries = Object.entries(settings);
  if (entries.length === 0) {
    return 0;
  }

  const client = await getSupabaseAdmin();
  if (!client) {
    throw new Error('Failed to initialize Supabase client');
  }

  // Separate entries: null/undefined values should be deleted, others upserted
  const toUpsert: [string, any][] = [];
  const toDelete: string[] = [];

  for (const [key, value] of entries) {
    if (value === null || value === undefined) {
      toDelete.push(key);
    } else {
      toUpsert.push([key, normalizeSettingValue(key, value)]);
    }
  }

  // Delete settings with null values
  if (toDelete.length > 0) {
    const { error: deleteError } = await client
      .from('settings')
      .delete()
      .in('key', toDelete);

    if (deleteError) {
      throw new Error(`Failed to delete settings: ${deleteError.message}`);
    }
  }

  // Upsert settings with non-null values
  if (toUpsert.length > 0) {
    const now = new Date().toISOString();
    const records = toUpsert.map(([key, value]) => ({
      key,
      value,
      updated_at: now,
    }));

    const { error } = await client
      .from('settings')
      .upsert(records, {
        onConflict: 'key',
      });

    if (error) {
      throw new Error(`Failed to set settings: ${error.message}`);
    }
  }

  return entries.length;
}
