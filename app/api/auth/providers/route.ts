import { NextResponse } from 'next/server';
import { getSupabaseAdmin, getSupabaseConfig } from '@/lib/supabase-server';
import { noCache } from '@/lib/api-response';

/**
 * GET /api/auth/providers
 * 
 * Fetches enabled OAuth providers directly from Supabase.
 */
export async function GET() {
  try {
    const config = await getSupabaseConfig();
    if (!config) {
      return noCache({ error: 'Supabase not configured' }, 500);
    }

    // We use the management/settings API of GoTrue
    // This typically requires service role key
    const response = await fetch(`${config.projectUrl}/auth/v1/settings`, {
      headers: {
        'apikey': config.serviceRoleKey,
        'Authorization': `Bearer ${config.serviceRoleKey}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch Supabase auth settings:', errorText);
      return noCache({ error: 'Failed to fetch auth settings from Supabase' }, response.status);
    }

    const settings = await response.json();
    
    // Extract providers that are enabled
    const providers = [];
    
    // Supabase returns external settings in an object where keys are provider names
    // or under an 'external' property depending on the version
    const external = settings.external || {};
    
    for (const [key, value] of Object.entries(external)) {
      if ((value as any).enabled) {
        providers.push(key);
      }
    }

    // Add email if it's enabled (usually under 'mailer' or just assumed)
    const emailEnabled = settings.mailer?.autoconfirm || settings.external?.email?.enabled || true;

    return noCache({
      providers,
      emailEnabled,
      raw: process.env.NODE_ENV === 'development' ? settings : undefined
    });

  } catch (error) {
    console.error('Error discovering auth providers:', error);
    return noCache({ error: 'Internal server error' }, 500);
  }
}
