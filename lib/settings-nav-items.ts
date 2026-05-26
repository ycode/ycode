/**
 * Settings navigation items for the settings sidebar.
 * Extracted for reuse and to allow cloud overlay to filter items.
 */

export interface SettingsNavItem {
  id: string;
  label: string;
  path: string;
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: 'general', label: 'General', path: '/ycode/settings/general' },
  { id: 'auth', label: 'Authentication', path: '/ycode/settings/auth' },
  { id: 'users', label: 'Users', path: '/ycode/settings/users' },
  { id: 'redirects', label: 'Redirects', path: '/ycode/settings/redirects' },
  { id: 'email', label: 'Email', path: '/ycode/settings/email' },
  { id: 'templates', label: 'Templates', path: '/ycode/settings/templates' },
  { id: 'updates', label: 'Updates', path: '/ycode/settings/updates' },
];
