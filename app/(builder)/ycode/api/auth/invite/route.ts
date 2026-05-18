import { NextRequest } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { noCache } from '@/lib/api-response';
import { AUTH_ROLES } from '@/lib/auth-constants';

/**
 * POST /ycode/api/auth/invite
 *
 * Invite a user by email using Supabase's built-in invite system
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, redirectTo } = body;

    if (!email) {
      return noCache(
        { error: 'Email is required' },
        400
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return noCache(
        { error: 'Invalid email format' },
        400
      );
    }

    const client = await getSupabaseAdmin();

    if (!client) {
      return noCache(
        { error: 'Supabase not configured' },
        500
      );
    }

    // Use Supabase's built-in invite functionality
    const { data, error } = await client.auth.admin.inviteUserByEmail(email, {
      redirectTo: redirectTo || undefined,
      data: {
        invited_at: new Date().toISOString(),
        role: AUTH_ROLES.ADMIN,
      },
    });

    if (error) {
      console.error('[invite] Error inviting user:', error);
      return noCache(
        { error: error.message },
        400
      );
    }

    return noCache({
      data: {
        user: data.user,
        message: `Invitation sent to ${email}`,
      },
    });
  } catch (error) {
    console.error('[invite] Unexpected error:', error);
    return noCache(
      { error: 'Failed to send invitation' },
      500
    );
  }
}
