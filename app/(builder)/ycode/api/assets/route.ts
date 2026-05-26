import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/supabase-auth';
import { getAllAssets, getAssetsPaginated, createAsset } from '@/lib/repositories/assetRepository';
import { uploadFile, cleanSvgContent, isValidSvg } from '@/lib/file-upload';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/assets
 *
 * Get assets with pagination and search support
 * Query params:
 * - folderId: string | 'null' - Filter by folder ID (use 'null' for root folder)
 * - folderIds: string - Comma-separated folder IDs (for search across multiple folders)
 * - search: string - Search by filename
 * - page: number - Page number (1-based, default: 1)
 * - limit: number - Items per page (default: 50)
 */
export async function GET(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { searchParams } = new URL(request.url);
    const folderIdParam = searchParams.get('folderId');
    const folderIdsParam = searchParams.get('folderIds');
    const search = searchParams.get('search') || undefined;
    const page = parseInt(searchParams.get('page') || '1', 10);
    const limit = parseInt(searchParams.get('limit') || '50', 10);

    // Parse folder ID(s)
    let folderId: string | null | undefined = undefined;
    let folderIds: string[] | undefined = undefined;

    if (folderIdsParam) {
      // Multiple folders (for search across descendants)
      folderIds = folderIdsParam.split(',').map(id => id.trim());
    } else if (folderIdParam !== null) {
      folderId = folderIdParam === 'null' ? null : folderIdParam;
    }

    const result = await getAssetsPaginated({
      folderId,
      folderIds,
      search,
      page,
      limit,
    });

    return noCache({
      data: result.assets,
      total: result.total,
      page: result.page,
      limit: result.limit,
      hasMore: result.hasMore,
    });
  } catch (error) {
    console.error('Failed to fetch assets:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch assets' },
      500
    );
  }
}

/**
 * POST /ycode/api/assets
 *
 * Upload a new asset (file upload) or create SVG asset from code
 * - FormData: File upload
 * - JSON: SVG creation from code
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const contentType = request.headers.get('content-type');

    // Handle JSON request for SVG creation
    if (contentType?.includes('application/json')) {
      const body = await request.json();
      const { filename, content, asset_folder_id, source = 'file-manager' } = body;

      if (!filename || !content) {
        return noCache(
          { error: 'Filename and content are required' },
          400
        );
      }

      // Clean SVG content
      const cleanedContent = cleanSvgContent(content);

      // Validate SVG content
      if (!isValidSvg(content)) {
        return noCache(
          { error: 'Invalid SVG code. Please provide a valid SVG element.' },
          400
        );
      }

      // Create asset record with inline SVG content
      const asset = await createAsset({
        filename,
        source,
        storage_path: null,
        public_url: null,
        file_size: cleanedContent.length,
        mime_type: 'image/svg+xml',
        asset_folder_id: asset_folder_id || null,
        content: cleanedContent,
      });

      return noCache({
        data: asset,
      });
    }

    // Handle FormData for file upload
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const source = formData.get('source') as string | null;

    if (!file) {
      return noCache(
        { error: 'No file provided' },
        400
      );
    }

    if (!source) {
      return noCache(
        { error: 'Source is required' },
        400
      );
    }

    // Upload file to Supabase Storage and create asset record
    // This automatically extracts dimensions for images
    const asset = await uploadFile(file, source);

    if (!asset) {
      return noCache(
        { error: 'Failed to upload asset' },
        500
      );
    }

    return noCache({
      data: asset,
    });
  } catch (error) {
    console.error('Failed to upload asset:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to upload asset' },
      500
    );
  }
}
