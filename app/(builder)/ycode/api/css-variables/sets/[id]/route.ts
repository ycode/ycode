import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import {
  deleteCssVariableSet,
  updateCssVariableSet,
} from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PUT /ycode/api/css-variables/sets/[id]
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateCssVariableSet(id, body);
    return noCache({ data: updated });
  } catch (error) {
    console.error('[PUT /ycode/api/css-variables/sets/[id]] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update CSS variable set' },
      cssVariableErrorStatus(error)
    );
  }
}

/**
 * DELETE /ycode/api/css-variables/sets/[id]
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteCssVariableSet(id);
    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('[DELETE /ycode/api/css-variables/sets/[id]] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete CSS variable set' },
      cssVariableErrorStatus(error)
    );
  }
}
