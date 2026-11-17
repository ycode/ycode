/**
 * Context describing the classes the design panel currently reads, so setting
 * labels can explain where each value comes from without prop drilling.
 */
import { createContext, useContext } from 'react';

import type { DesignPanelSource } from '@/lib/design-property-source';

export interface DesignPanelSourceContextValue extends DesignPanelSource {
  /** Switch the design panel to editing a layer style of the selected element */
  onSelectStyle?: (styleId: string) => void;
  /** Select another layer, e.g. the parent a value is inherited from */
  onSelectLayer?: (layerId: string) => void;
}

const DesignPropertySourceContext = createContext<DesignPanelSourceContextValue | null>(null);

export const DesignPropertySourceProvider = DesignPropertySourceContext.Provider;

/** Returns the design panel source, or null outside the design panel */
export function useDesignPanelSource(): DesignPanelSourceContextValue | null {
  return useContext(DesignPropertySourceContext);
}
