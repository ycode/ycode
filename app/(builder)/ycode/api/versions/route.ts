import { NextRequest, NextResponse } from 'next/server';
import {
  getVersionHistory,
  createVersion,
  shouldStoreSnapshot,
} from '@/lib/repositories/versionRepository';
import { getAdminUser } from '@/lib/supabase-auth';
import type { CreateVersionData, VersionEntityType } from '@/types';

/**
 * GET /ycode/api/versions
 * Get version history for an entity
 */
export async function GET(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType') as VersionEntityType | null;
    const entityId = searchParams.get('entityId');
    const limit = parseInt(searchParams.get('limit') || '50', 10);
    const offset = parseInt(searchParams.get('offset') || '0', 10);

    if (!entityType || !entityId) {
      return NextResponse.json(
        { error: 'entityType and entityId are required' },
        { status: 400 }
      );
    }

    // Validate entity type
    if (!['page_layers', 'component', 'layer_style'].includes(entityType)) {
      return NextResponse.json(
        { error: 'Invalid entityType' },
        { status: 400 }
      );
    }

    const versions = await getVersionHistory(entityType, entityId, limit, offset);

    return NextResponse.json({ data: versions });
  } catch (error) {
    console.error('Error fetching version history:', error);
    return NextResponse.json(
      { error: 'Failed to fetch version history' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/versions
 * Create a new version entry
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();

    const {
      entity_type,
      entity_id,
      action_type,
      description,
      redo,
      undo,
      snapshot,
      previous_hash,
      current_hash,
      session_id,
      metadata,
    } = body;

    // Validate required fields
    if (!entity_type || !entity_id || !action_type || !redo || !current_hash) {
      return NextResponse.json(
        { error: 'entity_type, entity_id, action_type, redo, and current_hash are required' },
        { status: 400 }
      );
    }

    // Validate entity type
    if (!['page_layers', 'component', 'layer_style'].includes(entity_type)) {
      return NextResponse.json(
        { error: 'Invalid entity_type' },
        { status: 400 }
      );
    }

    // Validate action type
    if (!['create', 'update', 'delete'].includes(action_type)) {
      return NextResponse.json(
        { error: 'Invalid action_type' },
        { status: 400 }
      );
    }

    // Determine if we should store a snapshot (every N versions)
    let finalSnapshot = snapshot || null;
    if (!finalSnapshot) {
      const shouldSnapshot = await shouldStoreSnapshot(entity_type, entity_id);
      // If we need a snapshot but none provided, the client should send current_state
      // For now, we'll rely on the undo patch chain for state reconstruction
      if (shouldSnapshot && body.current_state) {
        finalSnapshot = body.current_state;
      }
    }

    const versionData: CreateVersionData = {
      entity_type,
      entity_id,
      action_type,
      description: description || null,
      redo,
      undo: undo || null,
      snapshot: finalSnapshot,
      previous_hash: previous_hash || null,
      current_hash,
      session_id: session_id || null,
      metadata: metadata || null,
    };

    const version = await createVersion(versionData);

    return NextResponse.json({ data: version }, { status: 201 });
  } catch (error) {
    console.error('Error creating version:', error);
    return NextResponse.json(
      { error: 'Failed to create version' },
      { status: 500 }
    );
  }
}
