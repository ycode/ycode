import { NextRequest, NextResponse } from 'next/server';
import { randomBytes } from 'crypto';
import {
  getAllWebhooks,
  createWebhook,
  type CreateWebhookData,
  type WebhookEventType,
} from '@/lib/repositories/webhookRepository';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * GET /ycode/api/webhooks
 * List all webhooks
 */
export async function GET() {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const webhooks = await getAllWebhooks();
    return NextResponse.json({ data: webhooks });
  } catch (error) {
    console.error('Error fetching webhooks:', error);
    return NextResponse.json(
      { error: 'Failed to fetch webhooks' },
      { status: 500 }
    );
  }
}

/**
 * POST /ycode/api/webhooks
 * Create a new webhook
 *
 * Body: { name: string, url: string, events: string[], secret?: string, generateSecret?: boolean }
 */
export async function POST(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const body = await request.json();
    const { name, url, events, secret, generateSecret, filters } = body;

    // Validation
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json(
        { error: 'Name is required' },
        { status: 400 }
      );
    }

    if (!url || typeof url !== 'string') {
      return NextResponse.json(
        { error: 'URL is required' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      new URL(url);
    } catch {
      return NextResponse.json(
        { error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    if (!events || !Array.isArray(events) || events.length === 0) {
      return NextResponse.json(
        { error: 'At least one event type is required' },
        { status: 400 }
      );
    }

    // Generate secret if requested
    let webhookSecret = secret;
    if (generateSecret && !secret) {
      webhookSecret = randomBytes(32).toString('hex');
    }

    const webhookData: CreateWebhookData = {
      name: name.trim(),
      url: url.trim(),
      events: events as WebhookEventType[],
      secret: webhookSecret,
      filters: filters || null,
    };

    const webhook = await createWebhook(webhookData);

    // Return the webhook with the secret (only shown once if generated)
    return NextResponse.json({
      data: {
        ...webhook,
        // Include the plain secret only on creation if it was generated
        generated_secret: generateSecret ? webhookSecret : undefined,
      },
    }, { status: 201 });
  } catch (error) {
    console.error('Error creating webhook:', error);
    return NextResponse.json(
      { error: 'Failed to create webhook' },
      { status: 500 }
    );
  }
}
