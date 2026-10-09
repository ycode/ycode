import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import { createCssVariable } from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const ALLOWED_TYPES = new Set(['color', 'size', 'percentage', 'number', 'font_family']);

/**
 * POST /ycode/api/css-variables/items
 * Body: { set_id, type, name, group_id? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.set_id || !body?.type || !body?.name) {
      return noCache({ error: 'set_id, type and name are required' }, 400);
    }
    if (!ALLOWED_TYPES.has(body.type)) {
      return noCache({ error: `Invalid type: ${body.type}` }, 400);
    }
    const variable = await createCssVariable({
      set_id: body.set_id,
      type: body.type,
      name: body.name,
      group_id: body.group_id ?? null,
    });
    return noCache({ data: variable });
  } catch (error) {
    console.error('[POST /ycode/api/css-variables/items] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create CSS variable' },
      cssVariableErrorStatus(error)
    );
  }
}
