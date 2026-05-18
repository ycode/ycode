import { NextRequest, NextResponse } from 'next/server';
import { getAllLocales, createLocale } from '@/lib/repositories/localeRepository';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * GET /ycode/api/locales
 * Get all locales
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const locales = await getAllLocales();
    
    return NextResponse.json({ data: locales });
  } catch (error) {
    console.error('Error fetching locales:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locales' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/locales
 * Create a new locale
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { code, label, is_default } = body;
    
    if (!code || !label) {
      return NextResponse.json(
        { error: 'Missing required fields: code, label' },
        { status: 400 }
      );
    }
    
    const { locale, locales } = await createLocale({ code, label, is_default });
    
    return NextResponse.json({ data: { locale, locales } }, { status: 201 });
  } catch (error) {
    console.error('Error creating locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to create locale' },
      { status: 500 }
    );
  }
}
