import type { Page, PageFolder } from '@/types';
import { createHmac, randomUUID } from 'crypto';
import { getSupabaseAdmin } from '@/lib/supabase-server';
import { getSiteUser } from './supabase-auth';
import { getAppSettingValue } from './repositories/appSettingsRepository';
import { AUTH_SYSTEM_APP_ID } from './auth-constants';

/**
 * Page Password Protection Utilities
 *
 * Handles password-based access control for pages and folders.
 * Uses session cookies to track which pages/folders have been unlocked.
 * Uses dynamic import for cookies() to avoid tainting the module as dynamic.
 */

/** Cookie name for page authentication - exported for use in API routes */
export const PAGE_AUTH_COOKIE_NAME = 'ycode_page_auth';

const fallbackSecret = randomUUID();
let hasWarnedMissingSecret = false;

/**
 * Get the signing secret from environment.
 * Falls back to a per-process random value if PAGE_AUTH_SECRET is not set,
 * which means auth cookies won't persist across server restarts.
 */
function getSigningSecret(): string {
  const secret = process.env.PAGE_AUTH_SECRET;
  if (!secret) {
    if (!hasWarnedMissingSecret && process.env.NODE_ENV === 'production') {
      console.warn('[page-auth] PAGE_AUTH_SECRET is not set. Page password protection is using a temporary secret that resets on each deploy. Set PAGE_AUTH_SECRET in your environment variables (generate with: openssl rand -hex 32).');
      hasWarnedMissingSecret = true;
    }
    return fallbackSecret;
  }
  return secret;
}

/**
 * Sign a value using HMAC-SHA256
 */
function signValue(value: string): string {
  const secret = getSigningSecret();
  const hmac = createHmac('sha256', secret);
  hmac.update(value);
  return hmac.digest('hex');
}

/**
 * Verify a signed value
 */
function verifySignature(value: string, signature: string): boolean {
  const expectedSignature = signValue(value);
  return signature === expectedSignature;
}

/**
 * Cookie payload structure
 */
interface PageAuthCookie {
  // Array of unlocked page IDs
  pages: string[];
  // Array of unlocked folder IDs
  folders: string[];
}

/**
 * Parse the auth cookie and verify signature
 */
export async function parseAuthCookie(): Promise<PageAuthCookie | null> {
  try {
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const cookie = cookieStore.get(PAGE_AUTH_COOKIE_NAME);

    if (!cookie?.value) {
      return null;
    }

    // Cookie format: base64(json).signature
    const parts = cookie.value.split('.');
    if (parts.length !== 2) {
      return null;
    }

    const [encodedPayload, signature] = parts;

    // Verify signature
    if (!verifySignature(encodedPayload, signature)) {
      return null;
    }

    // Decode and parse
    const jsonPayload = Buffer.from(encodedPayload, 'base64').toString('utf-8');
    const payload = JSON.parse(jsonPayload) as PageAuthCookie;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Build a signed cookie value
 */
export function buildAuthCookieValue(payload: PageAuthCookie): string {
  const jsonPayload = JSON.stringify(payload);
  const encodedPayload = Buffer.from(jsonPayload).toString('base64');
  const signature = signValue(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

/**
 * Protection result from checking a page/folder
 */
export interface PageAccessResult {
  /** Whether the access is restricted */
  isRestricted: boolean;
  /** Type of restriction: 'password' or 'login' */
  restrictionType?: 'password' | 'login';
  /** The password required (only set if restrictionType is 'password') */
  password?: string;
  /** Whether restriction comes from page or folder */
  restrictedBy?: 'page' | 'folder';
  /** The ID of the page or folder that has the restriction */
  restrictedById?: string;
  /** Whether the current user/session has access */
  hasAccess: boolean;
  /** The login page ID to redirect to (if restrictionType is 'login') */
  loginPageId?: string | null;
}

/**
 * Get the effective access restriction for a page.
 * 
 * Priority:
 * 1. Page's own settings (password first, then login)
 * 2. Parent folder's settings (traverse up, closest folder wins)
 * 
 * @param page - The page to check
 * @param folders - All folders for hierarchy lookup
 * @param authCookie - Current password auth cookie payload (null if not set)
 */
export async function getPageAccess(
  page: Page,
  folders: PageFolder[],
  authCookie: PageAuthCookie | null,
  checkSession: boolean = false
): Promise<PageAccessResult> {
  // Check if Auth System is globally enabled
  const authConfig = await getAppSettingValue<{ enabled: boolean, login_page_id: string }>(AUTH_SYSTEM_APP_ID, 'config');
  const isAuthSystemEnabled = authConfig?.enabled ?? false;

  // 1. Check page itself
  const pageAuth = page.settings?.auth;
  if (pageAuth) {
    // Password protection
    if (pageAuth.enabled && pageAuth.password) {
      const isUnlocked = authCookie?.pages?.includes(page.id) ?? false;
      return {
        isRestricted: true,
        restrictionType: 'password',
        password: pageAuth.password,
        restrictedBy: 'page',
        restrictedById: page.id,
        hasAccess: isUnlocked,
      };
    }

    // Login protection check
    if (isAuthSystemEnabled && pageAuth.require_login) {
      const loginPageId = pageAuth.login_page_id || authConfig?.login_page_id;
      
      // If this IS the login page, grant access to avoid loop
      if (page.id === loginPageId) {
        return { isRestricted: true, restrictionType: 'login', restrictedBy: 'page', restrictedById: page.id, hasAccess: true };
      }

      // Check access - only if requested (fast path avoids cookies())
      let hasAccess = false;
      if (checkSession) {
        const siteAuth = await getSiteUser();
        hasAccess = !!siteAuth?.user;
      }

      return {
        isRestricted: true,
        restrictionType: 'login',
        restrictedBy: 'page',
        restrictedById: page.id,
        hasAccess,
        loginPageId,
      };
    }
  }

  // 2. Traverse folder hierarchy
  let currentFolderId = page.page_folder_id;

  while (currentFolderId) {
    const folder = folders.find(f => f.id === currentFolderId);
    if (!folder) break;

    const folderAuth = folder.settings?.auth;
    if (folderAuth) {
      // Password
      if (folderAuth.enabled && folderAuth.password) {
        const isUnlocked = authCookie?.folders?.includes(folder.id) ?? false;
        return {
          isRestricted: true,
          restrictionType: 'password',
          password: folderAuth.password,
          restrictedBy: 'folder',
          restrictedById: folder.id,
          hasAccess: isUnlocked,
        };
      }

      // Login
      if (isAuthSystemEnabled && folderAuth.require_login) {
        const loginPageId = folderAuth.login_page_id || authConfig?.login_page_id;
        
        // If this IS the login page, grant access to avoid loop
        if (page.id === loginPageId) {
          return { isRestricted: true, restrictionType: 'login', restrictedBy: 'folder', restrictedById: folder.id, hasAccess: true };
        }

        // Check access - only if requested
        let hasAccess = false;
        if (checkSession) {
          const siteAuth = await getSiteUser();
          hasAccess = !!siteAuth?.user;
        }

        return {
          isRestricted: true,
          restrictionType: 'login',
          restrictedBy: 'folder',
          restrictedById: folder.id,
          hasAccess,
          loginPageId,
        };
      }
    }

    currentFolderId = folder.page_folder_id;
  }

  // No restrictions
  return {
    isRestricted: false,
    hasAccess: true,
  };
}

/**
 * Protection result from checking a page/folder
 */
export interface PasswordProtectionResult {
  /** Whether the page is password protected */
  isProtected: boolean;
  /** The password required (only set if protected) */
  password?: string;
  /** Whether protection comes from page or folder */
  protectedBy?: 'page' | 'folder';
  /** The ID of the page or folder that has the password */
  protectedById?: string;
  /** Whether the current session has unlocked this protection */
  isUnlocked: boolean;
}

/**
 * Get the effective password protection for a page
 * 
 * Priority:
 * 1. Page's own password (if enabled)
 * 2. Parent folder's password (traverse up, closest folder wins)
 * 
 * @param page - The page to check
 * @param folders - All folders for hierarchy lookup
 * @param authCookie - Current auth cookie payload (null if not set)
 */
export function getPasswordProtection(
  page: Page,
  folders: PageFolder[],
  authCookie: PageAuthCookie | null
): PasswordProtectionResult {
  // Check if page itself has password protection
  if (page.settings?.auth?.enabled && page.settings.auth.password) {
    const isUnlocked = authCookie?.pages?.includes(page.id) ?? false;
    return {
      isProtected: true,
      password: page.settings.auth.password,
      protectedBy: 'page',
      protectedById: page.id,
      isUnlocked,
    };
  }

  // Traverse folder hierarchy from page's parent folder up to root
  let currentFolderId = page.page_folder_id;
  
  while (currentFolderId) {
    const folder = folders.find(f => f.id === currentFolderId);
    if (!folder) break;

    if (folder.settings?.auth?.enabled && folder.settings.auth.password) {
      const isUnlocked = authCookie?.folders?.includes(folder.id) ?? false;
      return {
        isProtected: true,
        password: folder.settings.auth.password,
        protectedBy: 'folder',
        protectedById: folder.id,
        isUnlocked,
      };
    }

    // Move to parent folder
    currentFolderId = folder.page_folder_id;
  }

  // No password protection
  return {
    isProtected: false,
    isUnlocked: true,
  };
}

/**
 * Fetch folders for password protection checks
 * 
 * @param isPublished - If true, fetch only published folders. If false, fetch all (for preview).
 * @returns Array of page folders
 */
export async function fetchFoldersForAuth(isPublished: boolean): Promise<PageFolder[]> {
  const supabase = await getSupabaseAdmin();
  if (!supabase) return [];

  let query = supabase
    .from('page_folders')
    .select('*')
    .is('deleted_at', null);

  if (isPublished) {
    query = query.eq('is_published', true);
  }

  const { data } = await query;
  return (data as PageFolder[]) || [];
}
