import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import { createCssVariableGroup } from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    if (!body?.set_id || !body?.name) {
      return noCache({ error: 'set_id and name are required' }, 400);
    }
    const group = await createCssVariableGroup({ set_id: body.set_id, name: body.name });
    return noCache({ data: group });
  } catch (error) {
    console.error('[POST /ycode/api/css-variables/groups] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to create CSS variable group' },
      cssVariableErrorStatus(error)
    );
  }
}
