import { NextRequest, NextResponse } from 'next/server';
import {
  getComponentById,
  updateComponent,
  updateComponentFolder,
  softDeleteComponent,
  restoreComponent,
  findEntitiesUsingComponent,
} from '@/lib/repositories/componentRepository';

/**
 * GET /ycode/api/components/[id]
 * Get a single component by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const component = await getComponentById(id);

    if (!component) {
      return NextResponse.json({ error: 'Component not found' }, { status: 404 });
    }

    return NextResponse.json({ data: component });
  } catch (error) {
    console.error('Error fetching component:', error);
    return NextResponse.json(
      { error: 'Failed to fetch component' },
      { status: 500 }
    );
  }
}

/**
 * PUT /ycode/api/components/[id]
 * Update a component (triggers sync across all instances)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, layers, variables, variants, folder } = body;

    const updates: any = {};
    if (name !== undefined) updates.name = name;
    if (layers !== undefined) updates.layers = layers;
    if (variables !== undefined) updates.variables = variables;
    if (variants !== undefined) updates.variants = variants;

    let component = Object.keys(updates).length > 0
      ? await updateComponent(id, updates)
      : null;

    // Folder changes skip the content hash, so they don't count as unpublished changes
    if (folder !== undefined) {
      component = await updateComponentFolder(id, folder);
    }

    if (!component) {
      return NextResponse.json({ error: 'No updates provided' }, { status: 400 });
    }

    return NextResponse.json({ data: component });
  } catch (error) {
    console.error('Error updating component:', error);
    const errorMessage = error instanceof Error ? error.message : 'Failed to update component';
    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}

/**
 * DELETE /ycode/api/components/[id]
 * Soft delete a component and detach it from all instances
 * Returns the deleted component and affected entities for undo/redo
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    // Soft delete the component and get affected entities
    const result = await softDeleteComponent(id);

    return NextResponse.json({
      data: {
        component: result.component,
        affectedEntities: result.affectedEntities,
      },
      message: 'Component deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting component:', error);
    return NextResponse.json(
      { error: 'Failed to delete component' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /ycode/api/components/[id]
 * Restore a soft-deleted component or get affected entities preview
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();

    // Check if this is a restore request
    if (body.action === 'restore') {
      const component = await restoreComponent(id);
      return NextResponse.json({ data: component });
    }

    // Check if this is a preview request (get affected entities without deleting)
    if (body.action === 'preview-delete') {
      const affectedEntities = await findEntitiesUsingComponent(id);
      return NextResponse.json({
        data: {
          affectedCount: affectedEntities.length,
          affectedEntities: affectedEntities.map(e => ({
            type: e.type,
            id: e.id,
            name: e.name,
            pageId: e.pageId,
          })),
        },
      });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error processing component action:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
