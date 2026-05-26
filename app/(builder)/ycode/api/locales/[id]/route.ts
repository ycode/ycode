import { NextRequest, NextResponse } from 'next/server';
import { getLocaleById, updateLocale, deleteLocale } from '@/lib/repositories/localeRepository';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * GET /ycode/api/locales/[id]
 * Get a single locale by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    const locale = await getLocaleById(id);
    
    if (!locale) {
      return NextResponse.json({ error: 'Locale not found' }, { status: 404 });
    }
    
    return NextResponse.json({ data: locale });
  } catch (error) {
    console.error('Error fetching locale:', error);
    return NextResponse.json(
      { error: 'Failed to fetch locale' },
      { status: 500 }
    );
  }
}

/**
 * PUT /ycode/api/locales/[id]
 * Update a locale
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { code, label, is_default } = body;
    
    const updates: any = {};
    if (code !== undefined) updates.code = code;
    if (label !== undefined) updates.label = label;
    if (is_default !== undefined) updates.is_default = is_default;
    
    const { locale, locales } = await updateLocale(id, updates);
    
    return NextResponse.json({ data: { locale, locales } });
  } catch (error) {
    console.error('Error updating locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to update locale' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /ycode/api/locales/[id]
 * Delete a locale (soft delete)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { id } = await params;
    await deleteLocale(id);
    
    return NextResponse.json({ message: 'Locale deleted successfully' });
  } catch (error) {
    console.error('Error deleting locale:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete locale' },
      { status: 500 }
    );
  }
}
