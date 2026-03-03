import { NextResponse } from 'next/server';
import { generateAndSaveDraftCSS } from '@/lib/server/cssGenerator';

export const dynamic = 'force-dynamic';

/**
 * POST /ycode/api/css/generate
 *
 * Regenerate draft CSS from all current draft layers and components.
 * Called by the MCP server after saving layers so that published
 * sites always have up-to-date CSS.
 */
export async function POST() {
  try {
    const css = await generateAndSaveDraftCSS();

    return NextResponse.json({
      data: {
        message: 'CSS generated and saved to draft_css',
        length: css.length,
      },
    });
  } catch (error) {
    console.error('Failed to generate CSS:', error);

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to generate CSS' },
      { status: 500 },
    );
  }
}
