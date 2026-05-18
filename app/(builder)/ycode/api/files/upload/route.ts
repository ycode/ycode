import { NextRequest, NextResponse } from 'next/server';
import { uploadFile } from '@/lib/file-upload';
import { validateCategoryMimeType } from '@/lib/asset-utils';
import { MAX_UPLOAD_FILE_SIZE } from '@/lib/asset-constants';
import { getAdminUser } from '@/lib/supabase-auth';

export const runtime = 'nodejs';

/**
 * POST /ycode/api/files/upload
 * Upload a file to Supabase Storage and create Asset record.
 * Used for small files that fit within serverless body limits.
 */
export async function POST(request: NextRequest) {
  const adminAuth = await getAdminUser();
  if (!adminAuth) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const customName = formData.get('name') as string | null;
    const source = formData.get('source') as string | null;
    const category = formData.get('category') as string | null;
    const assetFolderId = formData.get('asset_folder_id') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!source) {
      return NextResponse.json({ error: 'Source is required' }, { status: 400 });
    }

    const mimeError = validateCategoryMimeType(file.type, category);
    if (mimeError) {
      return NextResponse.json({ error: mimeError }, { status: 400 });
    }

    if (file.size > MAX_UPLOAD_FILE_SIZE) {
      return NextResponse.json(
        { error: 'File size must be less than 50MB' },
        { status: 400 }
      );
    }

    const asset = await uploadFile(
      file,
      source,
      customName || undefined,
      assetFolderId || undefined
    );

    if (!asset) {
      return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
    }

    return NextResponse.json({ data: asset }, { status: 200 });
  } catch (error) {
    console.error('Error uploading file:', error);
    return NextResponse.json({ error: 'Failed to upload file' }, { status: 500 });
  }
}
