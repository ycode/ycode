import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import { reorderCssVariableSets } from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PUT /ycode/api/css-variables/sets/reorder
 */
export async function PUT(request: NextRequest) {
  try {
    const { orderedIds } = await request.json();
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) {
      return noCache({ error: 'orderedIds array is required' }, 400);
    }
    await reorderCssVariableSets(orderedIds);
    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('[PUT /ycode/api/css-variables/sets/reorder] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to reorder CSS variable sets' },
      cssVariableErrorStatus(error)
    );
  }
}
