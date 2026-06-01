/**
 * Iframe Coordinate Utilities
 * 
 * Shared utilities for converting coordinates between iframe and window
 * coordinate systems. Used by drag-and-drop operations that span the
 * canvas iframe boundary.
 */

/**
 * Get the scale factor that maps the iframe's INNER coordinate system to OUTER
 * window pixels. The canvas is scaled with CSS `zoom` on a wrapper div.
 *
 * Preferred path derives the scale from geometry — the painted iframe width
 * divided by the inner root width, both measured via getBoundingClientRect.
 * This is robust across browsers: Safari propagates the wrapper's `zoom` into
 * the iframe's own measurements (inner rects come back already scaled), while
 * Chrome/Firefox report inner rects unscaled. The ratio yields the correct
 * multiplier in every browser (≈zoom in Chrome, ≈1 in Safari) and avoids the
 * double-scaling that misaligned canvas overlays/drag math on Safari.
 *
 * Falls back to reading CSS `zoom` / `transform: scale()` from an ancestor
 * wrapper when the iframe document isn't accessible yet (e.g. before load).
 */
export function getIframeScale(iframe: HTMLIFrameElement): number {
  const innerRoot = iframe.contentDocument?.documentElement;
  if (innerRoot) {
    const innerWidth = innerRoot.getBoundingClientRect().width;
    const outerWidth = iframe.getBoundingClientRect().width;
    if (innerWidth > 0 && outerWidth > 0) {
      return outerWidth / innerWidth;
    }
  }

  // Fallback: walk up ancestors for the CSS zoom / transform scale. The zoom
  // wrapper is not always the direct parent, so we don't stop at the first.
  let el: HTMLElement | null = iframe.parentElement;
  while (el) {
    const zoomValue = el.style.zoom;
    if (zoomValue) {
      const parsed = parseFloat(zoomValue);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    const match = (el.style.transform || '').match(/scale\(([\d.]+)\)/);
    if (match) return parseFloat(match[1]);
    el = el.parentElement;
  }
  return 1;
}

/**
 * Convert iframe-relative coordinates to window coordinates.
 * 
 * @param iframe - The canvas iframe element
 * @param iframeX - X coordinate in iframe's internal coordinate system
 * @param iframeY - Y coordinate in iframe's internal coordinate system
 * @returns Coordinates in the parent window's coordinate system
 */
export function iframeToWindowCoords(
  iframe: HTMLIFrameElement,
  iframeX: number,
  iframeY: number
): { windowX: number; windowY: number } {
  const iframeRect = iframe.getBoundingClientRect();
  const scale = getIframeScale(iframe);
  return {
    windowX: iframeRect.left + (iframeX * scale),
    windowY: iframeRect.top + (iframeY * scale),
  };
}

/**
 * Convert window coordinates to iframe-relative coordinates.
 * 
 * @param iframe - The canvas iframe element
 * @param windowX - X coordinate in window's coordinate system
 * @param windowY - Y coordinate in window's coordinate system
 * @returns Coordinates in the iframe's internal coordinate system
 */
export function windowToIframeCoords(
  iframe: HTMLIFrameElement,
  windowX: number,
  windowY: number
): { iframeX: number; iframeY: number } {
  const iframeRect = iframe.getBoundingClientRect();
  const scale = getIframeScale(iframe);
  return {
    iframeX: (windowX - iframeRect.left) / scale,
    iframeY: (windowY - iframeRect.top) / scale,
  };
}

/**
 * Check if window coordinates are within the iframe's visible bounds.
 */
export function isOverIframe(
  iframe: HTMLIFrameElement,
  windowX: number,
  windowY: number
): boolean {
  const iframeRect = iframe.getBoundingClientRect();
  return (
    windowX >= iframeRect.left &&
    windowX <= iframeRect.right &&
    windowY >= iframeRect.top &&
    windowY <= iframeRect.bottom
  );
}
