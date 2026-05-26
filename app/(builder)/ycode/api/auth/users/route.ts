import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * GET /ycode/api/auth/users
 *
 * List all users with their status (active or pending invite)
 */
export async function GET(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const client = await getSupabaseAdmin();

    if (!client) {
      return noCache(
        { error: 'Supabase not configured' },
        500
      );
    }

    // Fetch all users from Supabase Auth
    const { data, error } = await client.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (error) {
      console.error('[users] Error listing users:', error);
      return noCache(
        { error: error.message },
        500
      );
    }

    // Separate users into active and pending
    const activeUsers: Array<{
      id: string;
      email: string;
      display_name: string | null;
      avatar_url: string | null;
      created_at: string;
      last_sign_in_at: string | null;
    }> = [];

    const pendingInvites: Array<{
      id: string;
      email: string;
      invited_at: string;
    }> = [];

    for (const user of data.users) {
      // Check for the admin role - only admins/editors should be in this list
      const role = user.app_metadata?.role;
      if (role !== 'admin') {
        continue;
      }

      // Get metadata - check both user_metadata and raw_user_meta_data
       
      const userAny = user as any;
      const metadata = user.user_metadata || userAny.raw_user_meta_data || {};

      // Check if this user was invited (we set invited_at when sending invite)
      const wasInvited = !!metadata.invited_at;

      // A user is "pending" if:
      // 1. They were invited AND haven't signed in after the invite
      // 2. They have no identities (no password set)
      const hasIdentities = user.identities && user.identities.length > 0;
      const hasSignedIn = user.last_sign_in_at !== null;

      // User is pending if they were invited but haven't completed setup
      // (no sign-in after invite, or no identities meaning no password set)
      const isPending = wasInvited && (!hasSignedIn || !hasIdentities);

      if (!isPending) {
        activeUsers.push({
          id: user.id,
          email: user.email || '',
          display_name: metadata.display_name || metadata.full_name || null,
          avatar_url: metadata.avatar_url || null,
          created_at: user.created_at,
          last_sign_in_at: user.last_sign_in_at || null,
        });
      } else {
        // User was invited but hasn't completed setup
        pendingInvites.push({
          id: user.id,
          email: user.email || '',
          invited_at: metadata.invited_at || user.created_at,
        });
      }
    }

    return noCache({
      data: {
        activeUsers,
        pendingInvites,
      },
    });
  } catch (error) {
    console.error('[users] Unexpected error:', error);
    return noCache(
      { error: 'Failed to fetch users' },
      500
    );
  }
}

/**
 * DELETE /ycode/api/auth/users
 *
 * Delete a user or cancel a pending invite
 */
export async function DELETE(request: NextRequest) {
  try {
    const adminAuth = await getAdminUser();
    if (!adminAuth) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('id');

    if (!userId) {
      return noCache(
        { error: 'User ID is required' },
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

    const { error } = await client.auth.admin.deleteUser(userId);

    if (error) {
      console.error('[users] Error deleting user:', error);
      return noCache(
        { error: error.message },
        400
      );
    }

    return noCache({
      data: { success: true },
    });
  } catch (error) {
    console.error('[users] Unexpected error:', error);
    return noCache(
      { error: 'Failed to delete user' },
      500
    );
  }
}
