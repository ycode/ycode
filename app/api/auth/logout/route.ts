import { NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getSupabaseConfig } from '@/lib/supabase-server';

/**
 * POST /api/auth/logout
 */
export async function POST() {
  try {
    const config = await getSupabaseConfig();
    if (!config) return NextResponse.json({ error: 'Not configured' }, { status: 500 });

    const cookieStore = await cookies();
    const supabase = createServerClient(config.projectUrl, config.anonKey, {
      cookies: {
        getAll() { return cookieStore.getAll(); },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set({ name, value, ...options });
          });
        },
      },
    });

    await supabase.auth.signOut();

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: 'Logout failed' }, { status: 500 });
  }
}
