import type { SupabaseConfig, SupabaseCredentials } from '@/types';

/**
 * Replace [YOUR-PASSWORD] placeholder with actual password
 *
 * @param connectionUrl - Connection URL with [YOUR-PASSWORD] placeholder
 * @param password - Actual database password
 * @returns Connection URL with password inserted
 */
function replacePasswordPlaceholder(connectionUrl: string, password: string): string {
  // URL-encode the password to handle special characters
  const encodedPassword = encodeURIComponent(password);

  // Replace [YOUR-PASSWORD] with the actual password
  return connectionUrl.replace('[YOUR-PASSWORD]', encodedPassword);
}

/**
 * Extract the project ID from the connection URL
 *
 * @param connectionUrl - PostgreSQL connection string with [YOUR-PASSWORD] placeholder
 * @returns Project ID
 */
function extractProjectId(connectionUrl: string): string {
  // Example: "postgresql://postgres.abc123:[YOUR-PASSWORD]..." → extract "abc123"
  const match = connectionUrl.match(/\/\/postgres\.([a-z0-9]+):/);

  if (match) return match[1];

  throw new Error(
    'Invalid SUPABASE_CONNECTION_URL, the expected format is: postgresql://postgres.xxxxxxxxxx:[YOUR-PASSWORD]@aws-x-xx-xxxx-x.pooler.supabase.com:6543/postgres'
  );
}

/**
 * Parse Supabase Connection URL
 *
 * Parses a PostgreSQL connection string and extracts all necessary Supabase configuration.
 *
 * Expected formats:
 * 1. Direct: postgresql://postgres:[PASSWORD]@db.[PROJECT_ID].supabase.co:5432/postgres
 * 2. Pooler: postgresql://postgres.[PROJECT_ID]:[PASSWORD]@aws-x-xx-xxxx-x.pooler.supabase.com:6543/postgres
 *
 * @param connectionUrl - PostgreSQL connection string (with password already replaced)
 * @returns Parsed connection details
 */
export function parseConnectionUrl(connectionUrl: string): {
  projectId: string;
  projectUrl: string;
  dbPassword: string;
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
} {
  try {
    const url = new URL(connectionUrl);
    const dbHost = url.hostname;
    const dbPort = parseInt(url.port || '5432', 10);
    const dbName = url.pathname.slice(1);
    const dbUser = url.username;
    const dbPassword = decodeURIComponent(url.password);
    const projectId = extractProjectId(connectionUrl);

    // NEXT_PUBLIC_SUPABASE_URL: browser-accessible URL (e.g. http://localhost:3080)
    // SUPABASE_URL: server-side internal URL (e.g. http://kong:8000 inside Docker)
    // Fallback: construct from project ID for Supabase Cloud
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
      || process.env.SUPABASE_URL
      || `https://${projectId}.supabase.co`;

    return {
      projectId,
      projectUrl,
      dbPassword,
      dbHost,
      dbPort,
      dbName,
      dbUser,
    };
  } catch (error) {
    // If it's already one of our custom errors, just re-throw it
    if (error instanceof Error && error.message.includes('SUPABASE_CONNECTION_URL')) {
      throw error;
    }

    // Otherwise, wrap it with a helpful message
    const message = error instanceof Error ? error.message : 'Invalid format';
    throw new Error(
      `Failed to parse SUPABASE_CONNECTION_URL: ${message}\n\n` +
      'Expected format: postgresql://postgres.[PROJECT-ID]:[YOUR-PASSWORD]@aws-x-xx-xxxx-x.pooler.supabase.com:6543/postgres'
    );
  }
}

/**
 * Parse Supabase config and return full credentials
 *
 * @param config - SupabaseConfig with 4 core values
 * @returns Full SupabaseCredentials with derived properties
 */
export function parseSupabaseConfig(config: SupabaseConfig): SupabaseCredentials {
  // Replace [YOUR-PASSWORD] placeholder with actual password
  const connectionUrlResolved = replacePasswordPlaceholder(config.connectionUrl, config.dbPassword);

  // Parse the resolved connection URL
  const { dbPassword: _, ...parsedUrl } = parseConnectionUrl(connectionUrlResolved);

  return {
    anonKey: config.anonKey,
    serviceRoleKey: config.serviceRoleKey,
    connectionUrl: config.connectionUrl, // Original with placeholder
    dbPassword: config.dbPassword,
    ...parsedUrl,
  };
}

/**
 * Validate Supabase connection URL format
 *
 * @param connectionUrl - URL to validate (can have [YOUR-PASSWORD] placeholder)
 * @param password - Optional password to test with
 * @returns True if valid, throws error otherwise
 */
export function validateConnectionUrl(connectionUrl: string, password?: string): boolean {
  const testUrl = password
    ? replacePasswordPlaceholder(connectionUrl, password)
    : connectionUrl.replace('[YOUR-PASSWORD]', 'dummy-password-for-validation');

  parseConnectionUrl(testUrl);
  return true;
}
