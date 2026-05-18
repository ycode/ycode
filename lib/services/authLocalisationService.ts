import { getSupabaseAdmin } from '@/lib/supabase-server';
import type { Translation } from '@/types';

/**
 * Auth Localisation Service
 * 
 * Manages translatable strings for the authentication system.
 * Strings are stored in the 'translations' table with source_type='auth'.
 */

const AUTH_SOURCE_ID = 'auth_system';
const AUTH_SOURCE_TYPE = 'auth';

/**
 * Get a translated string for the auth system.
 * Falls back to the default text if no translation exists.
 */
export async function getAuthTranslation(
  key: string,
  defaultText: string,
  localeCode: string = 'en'
): Promise<string> {
  const adminClient = await getSupabaseAdmin();
  if (!adminClient) return defaultText;

  try {
    // 1. Get locale ID
    const { data: locale } = await adminClient
      .from('locales')
      .select('id')
      .eq('code', localeCode)
      .eq('is_published', true)
      .single();

    if (!locale) return defaultText;

    // 2. Get translation
    const { data: translation } = await adminClient
      .from('translations')
      .select('content_value')
      .eq('locale_id', locale.id)
      .eq('source_type', AUTH_SOURCE_TYPE)
      .eq('source_id', AUTH_SOURCE_ID)
      .eq('content_key', key)
      .eq('is_published', true)
      .single();

    return translation?.content_value || defaultText;
  } catch {
    return defaultText;
  }
}

/**
 * Seed default auth translations for a locale.
 * Useful for ensuring all auth keys exist in the database.
 */
export async function seedAuthTranslations(localeId: string, isPublished: boolean = false): Promise<void> {
  const adminClient = await getSupabaseAdmin();
  if (!adminClient) return;

  const defaultTranslations = [
    { key: 'error_email_required', value: 'Email is required' },
    { key: 'error_password_required', value: 'Password is required' },
    { key: 'error_invalid_credentials', value: 'Invalid email or password' },
    { key: 'error_user_exists', value: 'A user with this email already exists' },
    { key: 'error_registration_failed', value: 'Registration failed. Please try again.' },
    { key: 'success_login', value: 'Logged in successfully' },
    { key: 'success_registration', value: 'Registration successful' },
    { key: 'label_login', value: 'Log in' },
    { key: 'label_logout', value: 'Log out' },
    { key: 'label_my_profile', value: 'My Profile' },
  ];

  const translations = defaultTranslations.map(t => ({
    locale_id: localeId,
    source_type: AUTH_SOURCE_TYPE,
    source_id: AUTH_SOURCE_ID,
    content_key: t.key,
    content_type: 'text',
    content_value: t.value,
    is_completed: true,
    is_published: isPublished,
  }));

  await adminClient.from('translations').upsert(translations, {
    onConflict: 'locale_id,source_type,source_id,content_key,is_published'
  });
}
