import { unstable_cache as upstreamCache } from 'next/cache';
/** Development platform: no shared data cache until per-site invalidation is tested. */
export const unstable_cache: typeof upstreamCache = (fn, keys, options) =>
  process.env.COURSEY_PLATFORM === 'true' ? fn : upstreamCache(fn,keys,options);
