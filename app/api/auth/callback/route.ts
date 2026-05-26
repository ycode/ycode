import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { getSupabaseConfig } from '@/lib/supabase-server';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // if "next" is in search params, use it as the redirection URL
  const next = searchParams.get('next') ?? '/';

  if (code) {
    const config = await getSupabaseConfig();
    if (!config) {
      return NextResponse.redirect(`${origin}/auth/auth-code-error`);
    }

    const cookieStore = await cookies();
    const supabase = createServerClient(config.projectUrl, config.anonKey, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set({ name, value, ...options })
          );
        },
      },
    });
    
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // return the user to an error page with instructions
  return NextResponse.redirect(`${origin}/auth/auth-code-error`);
}
