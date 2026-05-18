import { NextRequest } from 'next/server';
import {
  updateColorVariable,
  deleteColorVariable,
} from '@/lib/repositories/colorVariableRepository';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PUT /ycode/api/color-variables/[id]
 */
export async function PUT(
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

    const updated = await updateColorVariable(id, body);

    return noCache({ data: updated });
  } catch (error) {
    console.error('[PUT /ycode/api/color-variables/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update color variable' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/color-variables/[id]
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    const { id } = await params;

    await deleteColorVariable(id);

    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('[DELETE /ycode/api/color-variables/[id]] Error:', error);

    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete color variable' },
      500
    );
  }
}
