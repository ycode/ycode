import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { getCssVariablesGraph } from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * GET /ycode/api/css-variables
 * Returns the full CSS variables graph (sets, modes, groups, variables, values).
 */
export async function GET() {
  try {
    const graph = await getCssVariablesGraph();
    return noCache({ data: graph });
  } catch (error) {
    console.error('[GET /ycode/api/css-variables] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to fetch CSS variables' },
      cssVariableErrorStatus(error)
    );
  }
}
