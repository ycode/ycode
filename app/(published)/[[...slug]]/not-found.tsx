import NotFound from '@/app/(site)/not-found';
import { isPublishedRouteFound } from '@/lib/published-page-data';

/**
 * 404 boundary for published pages.
 *
 * Next.js renders this boundary into the RSC payload of every page in the
 * segment, not only the ones that end up calling `notFound()`. Rendering the
 * custom 404 page unconditionally would ship its layers, CSS and fonts with
 * every page view, so it renders nothing when the requested page exists.
 */
export default async function PublishedNotFound() {
  if (await isPublishedRouteFound()) {
    return null;
  }

  return <NotFound />;
}
