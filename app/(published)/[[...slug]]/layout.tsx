import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import SiteDocumentLayout, { generateSiteMetadata } from '@/components/site-document-layout';
import { fetchGlobalPageSettings } from '@/lib/generate-page-metadata';
import { withCustom404Metadata } from '@/lib/not-found-metadata';
import { setPublishedRoute } from '@/lib/published-page-data';
import { resolveHtmlLang } from '@/lib/resolve-html-lang';
import { getSiteBaseUrl } from '@/lib/url-utils';

interface PublishedLayoutProps {
  children: ReactNode;
  params: Promise<{ slug?: string[] }>;
}

export async function generateMetadata({ params }: PublishedLayoutProps): Promise<Metadata> {
  const [siteMetadata, { slug }] = await Promise.all([generateSiteMetadata(), params]);

  return withCustom404Metadata(slug?.join('/') ?? '', siteMetadata);
}

/**
 * Root layout for published pages. Lives inside the optional catch-all so it
 * receives the URL slug at static-generation time and can set `<html lang>`,
 * `dir`, and `<body class>` in the first HTML byte — required for SEO / a11y
 * (no after-paint script). Cloud ISR stays intact because this does not call
 * headers().
 */
export default async function PublishedLayout({
  children,
  params,
}: PublishedLayoutProps) {
  const { slug } = await params;
  const slugPath = slug?.join('/') ?? '';
  const pathname = slugPath ? `/${slugPath}` : '/';

  // The 404 boundary renders inside this layout and reads the route from here
  setPublishedRoute(slugPath);

  const [lang, globalSettings] = await Promise.all([
    resolveHtmlLang(slugPath, true),
    fetchGlobalPageSettings().catch(() => null),
  ]);

  const baseUrl = getSiteBaseUrl({
    globalCanonicalUrl: globalSettings?.globalCanonicalUrl ?? null,
  });

  return (
    <SiteDocumentLayout
      lang={lang}
      pathname={pathname}
      baseUrl={baseUrl}
      publishedAt={globalSettings?.publishedAt ?? null}
      globalCustomCodeHead={globalSettings?.globalCustomCodeHead ?? null}
    >
      {children}
    </SiteDocumentLayout>
  );
}
