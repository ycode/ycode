import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import {
  deleteCssVariableSetMode,
  updateCssVariableSetMode,
} from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updated = await updateCssVariableSetMode(id, body);
    return noCache({ data: updated });
  } catch (error) {
    console.error('[PUT /ycode/api/css-variables/modes/[id]] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to update CSS variable set mode' },
      cssVariableErrorStatus(error)
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await deleteCssVariableSetMode(id);
    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('[DELETE /ycode/api/css-variables/modes/[id]] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete CSS variable set mode' },
      cssVariableErrorStatus(error)
    );
  }
}
