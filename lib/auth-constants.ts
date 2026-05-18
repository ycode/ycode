/**
 * Authentication System Constants
 */

export const USERS_COLLECTION_ID = '550e8400-e29b-41d4-a716-446655440000';

export const AUTH_SYSTEM_APP_ID = 'auth_system';

export const AUTH_ROLES = {
  ADMIN: 'admin',
  USER: 'user',
} as const;

export type AuthRole = typeof AUTH_ROLES[keyof typeof AUTH_ROLES];
