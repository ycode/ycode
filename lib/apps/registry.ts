/**
 * App Registry
 *
 * Central registry of all available app integrations.
 * Contributors can add new apps by:
 * 1. Adding an AppDefinition here
 * 2. Creating the app module under lib/apps/<app-id>/
 * 3. Adding a logo.svg in lib/apps/<app-id>/logo.svg
 * 4. Creating proxy API routes under app/ycode/api/apps/<app-id>/
 */

import type { StaticImageData } from 'next/image';

import airtableLogo from './airtable/logo.svg';
import webflowLogo from './webflow/logo.svg';
import mailerliteLogo from './mailerlite/logo.svg';
import mailchimpLogo from './mailchimp/logo.svg';
import zapierLogo from './zapier/logo.svg';
import makeLogo from './make/logo.svg';
import mapboxLogo from './mapbox/logo.png';
import googleMapsEmbedLogo from './google-maps-embed/logo.png';
import staticExportLogo from './static-export/logo.svg';

// =============================================================================
// Types
// =============================================================================

export type AppCategory = 'popular' | 'cms-data' | 'marketing' | 'automation' | 'analytics' | 'email' | 'maps' | 'other';

export const APP_CATEGORIES: { value: AppCategory; label: string }[] = [
  { value: 'popular', label: 'Popular' },
  { value: 'cms-data', label: 'CMS Data' },
  { value: 'marketing', label: 'Marketing' },
  { value: 'automation', label: 'Automation' },
  { value: 'analytics', label: 'Analytics' },
  { value: 'email', label: 'Email' },
  { value: 'maps', label: 'Maps' },
  { value: 'other', label: 'Other' },
];

export interface AppAuthor {
  /** Display name of the author or organization */
  name: string;
  /** Optional URL (e.g. GitHub profile) */
  url?: string;
}

export interface AppDefinition {
  /** Unique identifier (kebab-case), used as app_id in database */
  id: string;
  /** Display name */
  name: string;
  /** Short description */
  description: string;
  /** Static import of the app logo (place logo.svg in lib/apps/<app-id>/) */
  logo: StaticImageData;
  /** Categories for grouping (an app can belong to multiple categories) */
  categories: AppCategory[];
  /** Whether this app is fully implemented or just a placeholder */
  implemented: boolean;
  /** Author or contributor credit */
  author?: AppAuthor;
}

// =============================================================================
// Registered Apps
// =============================================================================

export const apps: AppDefinition[] = [
  {
    id: 'auth_system',
    name: 'Authentication',
    description: 'Enable user registration, login, and access control for your published site.',
    logo: airtableLogo, // Placeholder
    categories: ['popular'],
    implemented: true,
  },
  {
    id: 'airtable',
    name: 'Airtable',
    description: 'One-way sync from Airtable tables to your Ycode collections with real-time webhook support.',
    logo: airtableLogo,
    categories: ['popular', 'cms-data'],
    implemented: true,
    author: { name: 'Ycode', url: 'https://github.com/ycode/ycode' },
  },
  {
    id: 'webflow',
    name: 'Webflow CMS',
    description: 'One-click migrate a Webflow CMS site into Ycode collections, including assets and references.',
    logo: webflowLogo,
    categories: ['popular', 'cms-data'],
    implemented: true,
    author: { name: 'Ycode', url: 'https://github.com/ycode/ycode' },
  },
  {
    id: 'mailerlite',
    name: 'MailerLite',
    description: 'Send form submissions to MailerLite subscriber groups with field mapping.',
    logo: mailerliteLogo,
    categories: ['popular', 'email'],
    implemented: true,
    author: { name: 'Ycode', url: 'https://github.com/ycode/ycode' },
  },
  {
    id: 'mailchimp',
    name: 'Mailchimp',
    description: 'Sync form submissions with Mailchimp audiences and manage email campaigns.',
    logo: mailchimpLogo,
    categories: ['popular', 'email'],
    implemented: false,
  },
  {
    id: 'zapier',
    name: 'Zapier',
    description: 'Connect your website to 5,000+ apps with automated workflows.',
    logo: zapierLogo,
    categories: ['popular', 'automation'],
    implemented: false,
  },
  {
    id: 'make',
    name: 'Make',
    description: 'Build powerful automations with a visual workflow builder.',
    logo: makeLogo,
    categories: ['popular', 'automation'],
    implemented: false,
  },
  {
    id: 'mapbox',
    name: 'Mapbox',
    description: 'Add interactive maps to your pages with custom styles and markers using the Mapbox API.',
    logo: mapboxLogo,
    categories: ['popular', 'maps'],
    implemented: true,
    author: { name: 'Ycode', url: 'https://github.com/ycode/ycode' },
  },
  {
    id: 'google-maps-embed',
    name: 'Google Map',
    description: 'Add interactive maps to your pages with custom styles using the Google Maps Embed API.',
    logo: googleMapsEmbedLogo,
    categories: ['popular', 'maps'],
    implemented: true,
    author: { name: 'Ycode', url: 'https://github.com/ycode/ycode' },
  },
  {
    id: 'static-export',
    name: 'Static HTML Export',
    description: 'Export your site as static HTML/CSS/JS — host anywhere: S3, Netlify, Cloudflare Pages, or local files.',
    logo: staticExportLogo,
    categories: ['popular', 'other'],
    implemented: true,
    author: { name: 'Serge/Grish', url: 'https://github.com/sj-unit72' },
  },
];

// =============================================================================
// Helpers
// =============================================================================

/**
 * Get all registered apps
 */
export function getAllApps(): AppDefinition[] {
  return apps;
}

/**
 * Get a specific app by ID
 */
export function getAppById(id: string): AppDefinition | undefined {
  return apps.find((app) => app.id === id);
}

/**
 * Get apps filtered by category
 */
export function getAppsByCategory(category: AppCategory): AppDefinition[] {
  return apps.filter((app) => app.categories.includes(category));
}

/**
 * Get all unique categories that have at least one app
 */
export function getActiveCategories(): AppCategory[] {
  const categorySet = new Set<AppCategory>();
  for (const app of apps) {
    for (const cat of app.categories) {
      categorySet.add(cat);
    }
  }
  // Return in defined order
  return APP_CATEGORIES
    .map((c) => c.value)
    .filter((c) => categorySet.has(c));
}
