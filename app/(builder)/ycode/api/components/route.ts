import { NextRequest, NextResponse } from 'next/server';
import { getAllComponents, createComponent, renameComponentFolder } from '@/lib/repositories/componentRepository';

/**
 * GET /ycode/api/components
 * Get all components
 */
export async function GET() {
  try {
    const components = await getAllComponents();
    
    return NextResponse.json({ data: components });
  } catch (error) {
    console.error('Error fetching components:', error);
    return NextResponse.json(
      { error: 'Failed to fetch components' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/components
 * Create a new component
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, layers, variables, variants, folder } = body;
    
    if (!name || !layers) {
      return NextResponse.json(
        { error: 'Missing required fields: name, layers' },
        { status: 400 }
      );
    }
    
    const component = await createComponent({ name, layers, variables, variants, folder });
    
    return NextResponse.json({ data: component }, { status: 201 });
  } catch (error) {
    console.error('Error creating component:', error);
    return NextResponse.json(
      { error: 'Failed to create component' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /ycode/api/components
 * Bulk folder actions: `rename-folder` ({ from, to }); `to: null` removes the folder
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    if (body.action === 'rename-folder') {
      if (typeof body.from !== 'string' || !body.from.trim()) {
        return NextResponse.json({ error: 'Missing required field: from' }, { status: 400 });
      }

      const count = await renameComponentFolder(body.from, body.to ?? null);
      return NextResponse.json({ data: { count } });
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    console.error('Error processing components action:', error);
    return NextResponse.json(
      { error: 'Failed to process request' },
      { status: 500 }
    );
  }
}
