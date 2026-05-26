import { NextRequest, NextResponse } from 'next/server';
import { getAdminUser } from '@/lib/supabase-auth';
import { getAllComponents, createComponent } from '@/lib/repositories/componentRepository';

/**
 * GET /ycode/api/components
 * Get all components
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

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
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { name, layers, variables } = body;
    
    if (!name || !layers) {
      return NextResponse.json(
        { error: 'Missing required fields: name, layers' },
        { status: 400 }
      );
    }
    
    const component = await createComponent({ name, layers, variables });
    
    return NextResponse.json({ data: component }, { status: 201 });
  } catch (error) {
    console.error('Error creating component:', error);
    return NextResponse.json(
      { error: 'Failed to create component' },
      { status: 500 }
    );
  }
}
