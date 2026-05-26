import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/supabase-auth';
import { getAllStyles, createStyle } from '@/lib/repositories/layerStyleRepository';

/**
 * GET /ycode/api/layer-styles
 * List all layer styles (draft versions)
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const styles = await getAllStyles();
    return NextResponse.json({ data: styles });
  } catch (error) {
    console.error('Error fetching layer styles:', error);
    return NextResponse.json(
      { error: 'Failed to fetch layer styles' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/layer-styles
 * Create a new layer style
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    
    if (!body.name || body.classes === undefined) {
      return NextResponse.json(
        { error: 'Missing required fields: name and classes' },
        { status: 400 }
      );
    }
    
    const style = await createStyle({
      name: body.name,
      classes: body.classes,
      design: body.design,
      group: body.group,
    });
    
    return NextResponse.json({ data: style }, { status: 201 });
  } catch (error) {
    console.error('Error creating layer style:', error);
    return NextResponse.json(
      { error: 'Failed to create layer style' },
      { status: 500 }
    );
  }
}
