import { cssVariableErrorStatus } from '@/lib/css-variable-schemas';
import { NextRequest } from 'next/server';
import {
  deleteCssVariableValue,
  upsertCssVariableValue,
  upsertCssVariableValues,
} from '@/lib/repositories/cssVariableRepository';
import { noCache } from '@/lib/api-response';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * PUT /ycode/api/css-variables/values
 * Body: { values: [{ css_variable_id, mode_id, value }] }
 *   OR  { css_variable_id, mode_id, value } (single)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();

    if (Array.isArray(body?.values)) {
      await upsertCssVariableValues(body.values);
      return noCache({ data: { success: true } });
    }

    if (!body?.css_variable_id || !body?.mode_id) {
      return noCache({ error: 'css_variable_id and mode_id are required' }, 400);
    }

    const row = await upsertCssVariableValue({
      css_variable_id: body.css_variable_id,
      mode_id: body.mode_id,
      value: body.value ?? '',
    });
    return noCache({ data: row });
  } catch (error) {
    console.error('[PUT /ycode/api/css-variables/values] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to upsert CSS variable value' },
      cssVariableErrorStatus(error)
    );
  }
}

/**
 * DELETE /ycode/api/css-variables/values?css_variable_id=...&mode_id=...
 */
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const cssVariableId = url.searchParams.get('css_variable_id');
    const modeId = url.searchParams.get('mode_id');
    if (!cssVariableId || !modeId) {
      return noCache({ error: 'css_variable_id and mode_id are required' }, 400);
    }
    await deleteCssVariableValue(cssVariableId, modeId);
    return noCache({ data: { success: true } });
  } catch (error) {
    console.error('[DELETE /ycode/api/css-variables/values] Error:', error);
    return noCache(
      { error: error instanceof Error ? error.message : 'Failed to delete CSS variable value' },
      cssVariableErrorStatus(error)
    );
  }
}
