/**
 * Server-side role helpers for API routes.
 *
 * Authenticates the caller via Supabase session cookies and resolves
 * their role. Provides permission-check wrappers that return early
 * NextResponse errors so route handlers stay concise.
 */

import { getAuthUser } from '@/lib/supabase-auth';
import { noCache } from '@/lib/api-response';
import { resolveRole, canManageMembers as checkCanManage, type UserRole } from '@/lib/roles';

export interface CallerInfo {
  userId: string;
  role: UserRole;
}

/**
 * Authenticate the caller and resolve their role from app_metadata.
 * Returns null if not authenticated.
 */
export async function getCallerInfo(): Promise<CallerInfo | null> {
  if(process.env.COURSEY_PLATFORM === 'true') {
    try {const c=await (await import('@/coursey/runtime')).requireSite(); return {userId:c.userId!,role:c.role as UserRole};}
    catch {return null;}
  }
  const auth = await getAuthUser();
  if (!auth) return null;

  const role = resolveRole(auth.user.app_metadata?.role as string);
  return { userId: auth.user.id, role };
}

/**
 * Require the caller to be owner or admin.
 * Returns CallerInfo on success, or a 401/403 NextResponse on failure.
 */
export async function requireManageMembers() {
  const caller = await getCallerInfo();
  if (!caller) return noCache({ error: 'Not authenticated' }, 401);
  if (!checkCanManage(caller.role)) return noCache({ error: 'Insufficient permissions' }, 403);
  return caller;
}
