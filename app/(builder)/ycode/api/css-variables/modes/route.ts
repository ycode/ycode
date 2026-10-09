import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import { createCssVariableSetMode } from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * POST /ycode/api/css-variables/modes
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.set_id || !body?.name) {
      return noCache({ error: 'set_id and name are required' }, 400);
    }
    const mode = await createCssVariableSetMode({
      set_id: body.set_id,
      name: body.name,
      is_default: body.is_default,
      data_theme: body.data_theme,
      min_width: body.min_width,
    });
    return noCache({ data: mode });
  } catch (error) {
    console.error('[POST /ycode/api/css-variables/modes] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create CSS variable set mode' },
      cssVariableErrorStatus(error)
    );
  }
}
