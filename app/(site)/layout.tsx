import '@/app/site.css';
import type { Metadata } from 'next';
import { headers } from 'next/headers';
import RootLayoutShell, { defaultMetadata } from '@/components/RootLayoutShell';
import { fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { renderRootLayoutHeadCode } from '@/lib/parse-head-html';
import { resolvePageCustomHeadCode } from '@/lib/resolve-page-head-code';

export async function generateMetadata(): Promise<Metadata> {
  if (process.env.SKIP_SETUP === 'true') {
    return defaultMetadata;
  }

  try {
    const globalSettings = await fetchGlobalPageSettings();
    const metadata: Metadata = { ...defaultMetadata };

    if (globalSettings.faviconUrl || globalSettings.webClipUrl) {
      metadata.icons = {};
      if (globalSettings.faviconUrl) {
        metadata.icons.icon = globalSettings.faviconUrl;
      }
      if (globalSettings.webClipUrl) {
        metadata.icons.apple = globalSettings.webClipUrl;
      }
    }

    return metadata;
  } catch {
    return defaultMetadata;
  }
}

export default async function SiteLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const headElements: React.ReactNode[] = [];

  // Cloud mode uses ISR with explicit tenantId — calling headers() here
  // would force all pages dynamic. Cloud injects custom head code from
  // PageRenderer instead (meta/link/style hoist; inline scripts stay in body).
  if (process.env.SKIP_SETUP !== 'true') {
    // Must stay outside the data-fetch try/catch — Next.js throws a
    // special bailout from headers() to opt the layout into dynamic
    // rendering, and swallowing it would skip head injection entirely.
    const headersList = await headers();
    const pathname = headersList.get('x-pathname') || '/';

    try {
      const [globalSettings, pageCustomHead] = await Promise.all([
        fetchGlobalPageSettings(),
        resolvePageCustomHeadCode(pathname),
      ]);
      if (globalSettings.globalCustomCodeHead) {
        headElements.push(...renderRootLayoutHeadCode(globalSettings.globalCustomCodeHead));
      }
      if (pageCustomHead) {
        headElements.push(...renderRootLayoutHeadCode(pageCustomHead, 'page-head'));
      }
    } catch {
      // Supabase not configured — skip custom code
    }
  }

  // Published sites render text with the browser-default (`auto`) font
  // smoothing — matching legacy output. Forcing `antialiased` here would render
  // glyphs thinner/lighter than the original site.
  return (
    <RootLayoutShell headElements={headElements} bodyClassName="font-sans">
      {children}
    </RootLayoutShell>
  );
}
