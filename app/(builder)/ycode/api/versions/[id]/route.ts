import { NextRequest, NextResponse } from 'next/server';
import { getVersionById } from '@/lib/repositories/versionRepository';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * GET /ycode/api/versions/[id]
 * Get a specific version by ID
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

    const version = await getVersionById(id);

    if (!version) {
      return NextResponse.json(
        { error: 'Version not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ data: version });
  } catch (error) {
    console.error('Error fetching version:', error);
    return NextResponse.json(
      { error: 'Failed to fetch version' },
      { status: 500 }
    );
  }
}
