import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from '@/lib/supabase-server';

import { getAuthTranslation } from '@/lib/services/authLocalisationService';

/**
 * POST /api/auth/login
 * 
 * Handles site user login.
 */
export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const locale = url.searchParams.get('locale') || 'en';

  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      const errorMsg = await getAuthTranslation('error_email_required', 'Email and password are required', locale);
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const config = await getSupabaseConfig();
    if (!config) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const cookieStore = await cookies();

    const supabase = createServerClient(config.projectUrl, config.anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set({ name, value, ...options });
          });
        },
      },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const errorMsg = await getAuthTranslation('error_invalid_credentials', error.message, locale);
      return NextResponse.json({ error: errorMsg }, { status: 400 });
    }

    const successMsg = await getAuthTranslation('success_login', 'Login successful', locale);
    return NextResponse.json({
      data: {
        user: data.user,
        session: data.session,
        message: successMsg,
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
