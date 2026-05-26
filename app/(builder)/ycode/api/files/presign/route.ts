import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { validateCategoryMimeType } from '@/lib/asset-utils';
import { STORAGE_BUCKET, MAX_UPLOAD_FILE_SIZE, generateStoragePath } from '@/lib/asset-constants';

import { getAdminUser } from '@/lib/supabase-auth';

export const runtime = 'nodejs';

/**
 * POST /ycode/api/files/presign
 * Generate a signed upload URL for direct browser-to-storage uploads.
 * Used for large files that exceed serverless body limits.
 */
export async function POST(request: NextRequest) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { filename, mimeType, fileSize, category } = body as {
      filename: string;
      mimeType: string;
      fileSize: number;
      category?: string | null;
    };

    if (!filename || !mimeType || !fileSize) {
      return NextResponse.json(
        { error: 'filename, mimeType, and fileSize are required' },
        { status: 400 }
      );
    }

    const mimeError = validateCategoryMimeType(mimeType, category);
    if (mimeError) {
      return NextResponse.json({ error: mimeError }, { status: 400 });
    }

    if (fileSize > MAX_UPLOAD_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size must be less than 50MB' },
        { status: 400 }
      );
    }

    const supabase = await getSupabaseAdmin();

    if (!supabase) {
      return NextResponse.json({ error: 'Supabase not configured' }, { status: 500 });
    }

    const storagePath = generateStoragePath(filename);

    const { data, error } = await supabase.storage
      .from(STORAGE_BUCKET)
      .createSignedUploadUrl(storagePath);

    if (error) {
      console.error('Error creating signed upload URL:', error);
      return NextResponse.json({ error: 'Failed to create upload URL' }, { status: 500 });
    }

    return NextResponse.json({
      data: {
        signedUrl: data.signedUrl,
        token: data.token,
        storagePath,
      },
    });
  } catch (error) {
    console.error('Error in presign route:', error);
    return NextResponse.json({ error: 'Failed to generate upload URL' }, { status: 500 });
  }
}
