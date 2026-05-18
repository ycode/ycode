import { NextRequest } from 'next/server';
import { noCache } from '@/lib/api-response';
import { getAdminUser } from '@/lib/supabase-auth';

/**
 * PUT /ycode/api/profile/email
 *
 * Update user's email address (requires password confirmation)
 */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || typeof email !== 'string') {
      return noCache({ error: 'Email is required' }, 400);
    }

    if (!password || typeof password !== 'string') {
      return noCache({ error: 'Password is required to change email' }, 400);
    }

    const auth = await getAdminUser();
    if (!auth) {
      return noCache({ error: 'Not authenticated' }, 401);
    }

    // Verify current password by re-authenticating
    const { error: signInError } = await auth.client.auth.signInWithPassword({
      email: auth.user.email!,
      password,
    });

    if (signInError) {
      return noCache({ error: 'Incorrect password' }, 400);
    }

    // Update email
    const { data, error } = await auth.client.auth.updateUser({
      email: email.trim(),
    });

    if (error) {
      return noCache({ error: error.message }, 400);
    }

    return noCache({
      data: {
        user: data.user,
        message: 'Email update initiated. Check your new email for confirmation.',
      },
    });
  } catch (error) {
    console.error('Failed to update email:', error);
    return noCache({ error: 'Failed to update email' }, 500);
  }
}
