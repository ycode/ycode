/**
 * Leave preview mode when Escape is pressed, unless an open dialog or popover
 * already handled the key.
 * @param doc - Document the event came from (the preview iframe's or the builder's)
 */
export function exitPreviewOnEscape(e: KeyboardEvent, doc: Document = document): void {
  if (e.key !== 'Escape' || e.defaultPrevented) return;
  if (doc.querySelector('[role="dialog"]')) return;

  e.preventDefault();
  window.dispatchEvent(new CustomEvent('togglePreview'));
}
