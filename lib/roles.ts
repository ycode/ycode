/**
 * Shared role definitions and permission helpers.
 *
 * Role hierarchy: owner > admin > designer > editor
 */

export const ALL_ROLES = ['owner', 'admin', 'designer', 'editor', 'viewer'] as const;
export type UserRole = (typeof ALL_ROLES)[number];

export const ASSIGNABLE_ROLES = ['admin', 'designer', 'editor'] as const;
export const DEFAULT_ROLE: UserRole = 'designer';

export function resolveRole(raw: string | undefined | null): UserRole {
  if (raw && ALL_ROLES.includes(raw as UserRole)) return raw as UserRole;
  return DEFAULT_ROLE;
}

export function extractRoleFromUser(user: { app_metadata?: Record<string, unknown> } | null): UserRole | null {
  return (user?.app_metadata?.role as UserRole) || null;
}

export function canManageMembers(role: UserRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function canEditStructure(role: UserRole): boolean {
  return role !== 'editor' && role !== 'viewer';
}

export function canManageSettings(role: UserRole): boolean {
  return role !== 'editor' && role !== 'viewer';
}
