/**
 * Centralized role access hook for the builder.
 *
 * Reads the user's role from the auth store (populated from Supabase
 * app_metadata) and exposes boolean permission helpers.
 *
 * Role hierarchy: owner > admin > designer > editor
 * - editor: content-only (text, images, component fields, translations, CMS items)
 * - designer: full builder access (layout, design, content)
 * - admin: designer + member/settings management
 * - owner: admin + destructive actions
 */

import { useAuthStore } from '@/stores/useAuthStore';
import {
  resolveRole,
  canManageMembers,
  canEditStructure,
  canManageSettings,
  type UserRole,
} from '@/lib/roles';

export type { UserRole };

export function useRole() {
  const role = resolveRole(useAuthStore(state => state.role));

  return {
    role,
    isEditor: role === 'editor',
    canEditStructure: canEditStructure(role),
    canEditContent: role !== 'viewer',
    canManageMembers: canManageMembers(role),
    canManageSettings: canManageSettings(role),
  };
}
