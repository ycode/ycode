import { NextRequest, NextResponse } from 'next/server';
import { deleteAsset } from '@/lib/repositories/assetRepository';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * DELETE /ycode/api/files/delete
 * Soft-delete an asset (marks as deleted_at in database)
 * Physical file is only deleted when publishing if the asset was never published
 */
export async function DELETE(request: NextRequest) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const assetId = searchParams.get('assetId');

    if (!assetId) {
      return NextResponse.json(
        { error: 'Asset ID is required' },
        { status: 400 }
      );
    }

    await deleteAsset(assetId);

    return NextResponse.json(
      { message: 'Asset deleted successfully' },
      { status: 200 }
    );
  } catch (error) {
    console.error('Error deleting asset:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to delete asset' },
      { status: 500 }
    );
  }
}
