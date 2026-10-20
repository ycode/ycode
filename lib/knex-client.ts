import knex, { Knex } from 'knex';
import knexfileConfig from '../knexfile';

/**
 * Knex Client for Ycode Migrations
 *
 * Creates a knex instance connected to the user's Supabase PostgreSQL database
 * Uses configuration from knexfile.ts based on NODE_ENV
 *
 * The instance is stored on globalThis so it survives Next.js HMR in dev mode.
 * Without this, each hot reload re-evaluates the module, resets the module-level
 * variable to null, and creates a new pool — leaking the old pool's PostgreSQL
 * connections until the database is exhausted.
 */

const globalForKnex = globalThis as unknown as { __knexInstance?: Knex };

/**
 * Get or create knex instance
 */
export async function getKnexClient(): Promise<Knex> {
  if (process.env.COURSEY_PLATFORM === 'true') return (await import('@/coursey/runtime')).siteSql();
  if (globalForKnex.__knexInstance) {
    return globalForKnex.__knexInstance;
  }

  const environment = process.env.NODE_ENV || 'development';
  const config = knexfileConfig[environment];

  if (!config) {
    throw new Error(`No knex configuration found for environment: ${environment}`);
  }

  globalForKnex.__knexInstance = knex(config);

  return globalForKnex.__knexInstance;
}

/**
 * Close knex connection
 */
export async function closeKnexClient(): Promise<void> {
  if (globalForKnex.__knexInstance) {
    await globalForKnex.__knexInstance.destroy();
    globalForKnex.__knexInstance = undefined;
  }
}

/**
 * Test database connection using stored credentials
 */
export async function testKnexConnection(): Promise<boolean> {
  try {
    const client = await getKnexClient();
    await client.raw('SELECT 1');
    return true;
  } catch (error) {
    console.error('[testKnexConnection] ✗ Database connection test failed:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      code: (error as any)?.code,
      detail: (error as any)?.detail,
    });

    // Clean up on error
    try {
      await closeKnexClient();
    } catch (closeError) {
      console.error('[testKnexConnection] Error closing failed connection:', closeError);
    }

    return false;
  }
}

/**
 * Test database connection with Supabase credentials
 * Used during setup to validate credentials before storing them
 */
export async function testSupabaseDirectConnection(credentials: {
  dbHost: string;
  dbPort: number;
  dbName: string;
  dbUser: string;
  dbPassword: string;
  ssl?: boolean;
}): Promise<{
  success: boolean;
  error?: string;
}> {
  let testClient: Knex | null = null;

  try {

    // Create a temporary knex instance with the provided credentials
    testClient = knex({
      client: 'pg',
      connection: {
        host: credentials.dbHost,
        port: credentials.dbPort,
        database: credentials.dbName,
        user: credentials.dbUser,
        password: credentials.dbPassword,
        ssl: credentials.ssl === false ? false : { rejectUnauthorized: false },
      },
      pool: {
        min: 0,
        max: 1,
      },
    });

    // Test the connection
    await testClient.raw('SELECT 1');

    return { success: true };
  } catch (error) {
    console.error('[testSupabaseDirectConnection] ✗ Database connection test failed:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      code: (error as any)?.code,
      detail: (error as any)?.detail,
    });

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Database connection failed',
    };
  } finally {
    // Always clean up the test client
    if (testClient) {
      try {
        await testClient.destroy();
      } catch (closeError) {
        console.error('[testSupabaseDirectConnection] Error closing test connection:', closeError);
      }
    }
  }
}
