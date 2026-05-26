import { NextRequest, NextResponse } from 'next/server';
import { getFieldsByCollectionId, createField, getFieldById } from '@/lib/repositories/collectionFieldRepository';
import { isValidFieldType, VALID_FIELD_TYPES } from '@/lib/collection-field-utils';
import { getAdminUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';

// Disable caching for this route
export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/collections/[id]/fields
 * Get all fields for a collection (draft version)
 * Query params:
 *  - search: string (optional) - Filter fields by name
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { id } = await params;

    // Extract search query parameter
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || undefined;

    const filters = search ? { search } : undefined;

    // Always get draft fields in the builder
    const fields = await getFieldsByCollectionId(id, false, filters);

    return noCache({ data: fields });
  } catch (error) {
    console.error('Error fetching collection fields:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch fields' },
      500
    );
  }
}

/**
 * POST /ycode/api/collections/[id]/fields
 * Create a new field for a collection (draft)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { id } = await params;

    const body = await request.json();

    // Validate required fields
    if (!body.name || !body.type) {
      return noCache(
        { error: 'Missing required fields: name, type' },
        400
      );
    }

    // Validate field type
    if (!isValidFieldType(body.type)) {
      return noCache(
        { error: `Invalid field type. Must be one of: ${VALID_FIELD_TYPES.join(', ')}` },
        400
      );
    }

    let isComputed = body.is_computed ?? false;
    let fillable = body.fillable ?? true;
    let fieldData = body.data || {};

    if (body.type === 'count') {
      const cfg = body.data?.count;
      if (!cfg?.collectionId || !cfg?.fieldId) {
        return noCache(
          { error: 'Count fields require data.count.collectionId and data.count.fieldId' },
          400,
        );
      }

      const sourceField = await getFieldById(cfg.fieldId, false);
      if (!sourceField || sourceField.collection_id !== cfg.collectionId) {
        return noCache({ error: 'Count source field not found in the chosen collection' }, 400);
      }
      if (sourceField.type !== 'reference' && sourceField.type !== 'multi_reference') {
        return noCache({ error: 'Count source field must be a reference or multi_reference field' }, 400);
      }
      if (sourceField.reference_collection_id !== id) {
        return noCache({ error: 'Count source field must reference this collection' }, 400);
      }

      isComputed = true;
      fillable = false;
      fieldData = { ...fieldData, count: { collectionId: cfg.collectionId, fieldId: cfg.fieldId } };
    }

    const field = await createField({
      collection_id: id,
      name: body.name,
      key: body.key || null,
      type: body.type,
      default: body.default || null,
      fillable,
      order: body.order ?? 0,
      reference_collection_id: body.reference_collection_id || null,
      hidden: body.hidden ?? false,
      is_computed: isComputed,
      data: fieldData,
      is_published: false,
    });

    return noCache(
      { data: field },
      201
    );
  } catch (error) {
    console.error('Error creating field:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create field' },
      500
    );
  }
}
