import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import { createCssVariableSet } from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /ycode/api/css-variables/sets
 * Creates a new CSS variable set (also provisions a Default mode).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.name) {
      return noCache({ error: 'name is required' }, 400);
    }
    const set = await createCssVariableSet({
      name: body.name,
      activation_kind: body.activation_kind,
    });
    return noCache({ data: set });
  } catch (error) {
    console.error('[POST /ycode/api/css-variables/sets] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create CSS variable set' },
      cssVariableErrorStatus(error)
    );
  }
}
