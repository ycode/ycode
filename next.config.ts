import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },

  // Ensure sharp works properly in serverless environments (Vercel)
  // Also externalize Knex database drivers (we only use PostgreSQL)
  // This works for both webpack and Turbopack
  serverExternalPackages: [
    'sharp',
    'oracledb',
    'mysql',
    'mysql2',
    'sqlite3',
    'better-sqlite3',
    'tedious',
    'pg-query-stream',
  ],

  // Turbopack configuration
  // Map unused database drivers to stub modules (we only use PostgreSQL)
  // This prevents Turbopack from trying to resolve packages that aren't installed
  turbopack: {
    resolveAlias: {
      // Map unused database drivers to stub module to prevent resolution errors
      'oracledb': './lib/stubs/db-driver-stub.ts',
      'mysql': './lib/stubs/db-driver-stub.ts',
      'mysql2': './lib/stubs/db-driver-stub.ts',
      'sqlite3': './lib/stubs/db-driver-stub.ts',
      'better-sqlite3': './lib/stubs/db-driver-stub.ts',
      'tedious': './lib/stubs/db-driver-stub.ts',
      'pg-query-stream': './lib/stubs/db-driver-stub.ts',
    },
  },

  async headers() {
    return [
      {
        // Asset proxy: immutable caching (content-addressed by hash)
        source: '/a/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
      {
        // Apply to public pages ONLY (exclude /ycode/*, /_next/*, /a/*)
        source: '/:path((?!ycode|_next|a/).*)*',
        headers: [
          {
            key: 'Cache-Control',
            // Cache until re-published: CDN caches for up to 1 year
            // On publish, revalidatePath purges CDN; revalidateTag purges data cache
            value: 'public, s-maxage=31536000, stale-while-revalidate=31536000',
          },
        ],
      },
    ];
  },

  webpack: (config, { isServer }) => {
    if (isServer) {
      // Ignore optional dependencies that Knex tries to load
      // We only use PostgreSQL, so we don't need these drivers
      config.externals = config.externals || [];
      config.externals.push({
        'oracledb': 'commonjs oracledb',
        'mysql': 'commonjs mysql',
        'mysql2': 'commonjs mysql2',
        'sqlite3': 'commonjs sqlite3',
        'better-sqlite3': 'commonjs better-sqlite3',
        'tedious': 'commonjs tedious',
        'pg-query-stream': 'commonjs pg-query-stream',
      });
    }

    // Suppress Knex migration warnings (we don't use migrations in Next.js runtime)
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      {
        module: /node_modules\/knex\/lib\/migrations\/util\/import-file\.js/,
        message: /Critical dependency: the request of a dependency is an expression/,
      },
    ];

    return config;
  },
};

export default nextConfig;
