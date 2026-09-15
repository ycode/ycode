import cloneDeep from 'lodash/cloneDeep';
import type { Component, Layer } from '@/types';

/**
 * Create a component from the given layers via the builder API.
 *
 * Builder-only: this posts to `/ycode/api/components` and pulls in `cloneDeep`,
 * so it lives outside `layer-utils.ts` to keep both out of the published-page
 * client bundle.
 */
export async function createComponentViaApi(
  componentName: string,
  layers: Layer[]
): Promise<Component | null> {
  try {
    const response = await fetch('/ycode/api/components', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: componentName,
        layers: layers.map(layer => cloneDeep(layer)),
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
      } catch {
        errorMessage = errorText || errorMessage;
      }
      console.error('Failed to create component:', errorMessage);
      return null;
    }

    const result = await response.json();

    if (result.error || !result.data) {
      console.error('Failed to create component:', result.error);
      return null;
    }

    return result.data;
  } catch (error) {
    console.error('Failed to create component:', error);
    return null;
  }
}
