import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { syncUserToCms } from '@/lib/services/userSyncService';
import { AUTH_ROLES } from '@/lib/auth-constants';

import { getAuthTranslation } from '@/lib/services/authLocalisationService';

/**
 * POST /api/auth/register
 * 
 * Handles site user registration.
 * Creates a user in Supabase Auth with 'user' role and syncs to CMS.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') || 'en';

  try {
    const body = await request.json();
    const { email, password, full_name, ...customData } = body;

    if (!email || !password) {
      const errorMsg = await getAuthTranslation('error_email_required', 'Email and password are required', locale);
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const adminClient = await getSupabaseAdmin();
    if (!adminClient) {
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // 1. Create user in Supabase Auth
    const { data, error } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Auto-confirm for now as requested
      user_metadata: {
        full_name,
      },
      app_metadata: {
        role: AUTH_ROLES.USER,
      }
    });

    if (error) {
      const errorMsg = await getAuthTranslation('error_registration_failed', error.message, locale);
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    if (!data.user) {
      const errorMsg = await getAuthTranslation('error_registration_failed', 'Failed to create user', locale);
      return NextResponse.json({ error: errorMsg }, { status: 500 });
    }

    // 2. Sync to CMS
    // Convert field IDs from form (if any) to values for sync
    const cmsData: Record<string, string> = {};
    Object.entries(customData).forEach(([key, value]) => {
      // If key is a UUID, it's likely a CMS field ID from our AuthForm
      cmsData[key] = String(value);
    });

    await syncUserToCms(data.user, cmsData);

    const successMsg = await getAuthTranslation('success_registration', 'Registration successful', locale);

    return NextResponse.json({
      data: {
        user: {
          id: data.user.id,
          email: data.user.email,
        },
        message: successMsg,
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
