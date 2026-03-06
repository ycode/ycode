'use client';

/**
 * InteractionsPanel - Manages layer interactions and animations
 *
 * Handles triggers (click, hover, etc.) and their associated transitions
 */

// 1. React/Next.js
import React, { useState, useCallback, useMemo, useEffect } from 'react';

// 2. External libraries
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { restrictToParentElement } from '@dnd-kit/modifiers';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import gsap from 'gsap';
import { SplitText } from 'gsap/SplitText';

// Register GSAP plugins
if (typeof window !== 'undefined') {
  gsap.registerPlugin(SplitText);
}

// 3. ShadCN UI
import Icon, { IconProps } from '@/components/ui/icon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Empty, EmptyDescription } from '@/components/ui/empty';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';

// 3. Utils
import { cn, generateId } from '@/lib/utils';
import { getLayerName, getLayerIcon, findLayerById } from '@/lib/layer-utils';
import {
  PROPERTY_OPTIONS,
  TRIGGER_LABELS,
  START_POSITION_OPTIONS,
  EASE_OPTIONS,
  TOGGLE_ACTION_OPTIONS,
  calculateTweenStartTime,
  toGsapValue,
  getTweenProperties,
  isPropertyInTween,
  buildGsapProps,
  addTweenToTimeline,
  createSplitTextAnimation,
  updateInteractionById,
  updateInteractionTweens,
  updateTweenById,
} from '@/lib/animation-utils';
import type { TriggerType, PropertyType } from '@/lib/animation-utils';

// 4. Types
import type { Layer, LayerInteraction, InteractionTimeline, InteractionTween, TweenProperties, Breakpoint } from '@/types';
import { BREAKPOINTS, BREAKPOINT_VALUES } from '@/lib/breakpoint-utils';
import { Badge } from '@/components/ui/badge';

interface InteractionsPanelProps {
  triggerLayer: Layer;
  allLayers: Layer[]; // All layers available for target selection
  onLayerUpdate: (layerId: string, updates: Partial<Layer>) => void;
  selectedLayerId?: string | null; // Currently selected layer in editor
  resetKey?: number; // When this changes, reset all selections
  activeBreakpoint?: Breakpoint;
  onStateChange?: (state: {
    selectedTriggerId?: string | null;
    shouldRefresh?: boolean;
  }) => void;
  onSelectLayer?: (layerId: string) => void; // Callback to select a layer in the editor
}

// Sortable animation item component
interface SortableAnimationItemProps {
  tween: InteractionTween;
  index: number;
  tweens: InteractionTween[];
  isSelected: boolean;
  targetLayer: Layer | null;
  onSelect: () => void;
  onRemove: () => void;
  onSelectLayer?: (layerId: string) => void;
}

function SortableAnimationItem({
  tween,
  index,
  tweens,
  isSelected,
  targetLayer,
  onSelect,
  onRemove,
  onSelectLayer,
}: SortableAnimationItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tween.id });

  const style: React.CSSProperties = {
    transform: transform ? `translateY(${transform.y}px)` : undefined,
    transition,
    opacity: isDragging ? 0.5 : 1,
    cursor: isDragging ? 'grabbing' : 'grab',
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={() => {
        onSelect();
        onSelectLayer?.(tween.layer_id);
      }}
      className={cn(
        'px-2 py-1.25 flex items-center gap-1.75 rounded-lg transition-colors',
        isSelected
          ? 'bg-teal-500/50 text-primary-foreground'
          : 'bg-secondary/50 hover:bg-secondary'
      )}
    >
      <div
        className={cn(
          'size-5 flex items-center justify-center rounded-[6px]',
          isSelected ? 'bg-primary-foreground/20' : 'bg-secondary'
        )}
      >
        <Icon
          name={targetLayer ? getLayerIcon(targetLayer) : 'layers'}
          className="size-2.5"
        />
      </div>

      <Label className="flex-1 truncate cursor-[inherit]!">
        {targetLayer ? getLayerName(targetLayer) : `Animation #${index + 1}`}
      </Label>

      <Badge variant="secondary" className="text-[11px]">
        {(() => {
          const startTime = calculateTweenStartTime(tweens, index);
          // Calculate stagger amount if splitText is enabled
          const staggerAmount = tween.splitText?.stagger?.amount || 0;
          const endTime = startTime + tween.duration + staggerAmount;
          return (
            <>
              {startTime.toFixed(1)}s
              <Icon name="chevronRight" className="opacity-70 shrink-0" />
              {endTime.toFixed(1)}s
            </>
          );
        })()}
      </Badge>

      <Button
        size="xs"
        variant="ghost"
        className="-mr-0.5 cursor-pointer!"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
      >
        <Icon name="x" />
      </Button>
    </div>
  );
}

export default function InteractionsPanel({
  triggerLayer,
  allLayers,
  onLayerUpdate,
  selectedLayerId,
  resetKey,
  activeBreakpoint = 'desktop',
  onStateChange,
  onSelectLayer,
}: InteractionsPanelProps) {
  const [selectedInteractionId, setSelectedInteractionId] = useState<string | null>(null);
  const [selectedTweenId, setSelectedTweenId] = useState<string | null>(null);
  const [positionInput, setPositionInput] = useState('0');
  const [durationInput, setDurationInput] = useState('0');
  const [staggerInput, setStaggerInput] = useState('0');
  const previewedElementRef = React.useRef<{ layerId: string; element: HTMLElement; originalStyle: string; wasHidden: boolean } | null>(null);
  const previewTweenRef = React.useRef<gsap.core.Tween | null>(null);
  const previewTimelineRef = React.useRef<gsap.core.Timeline | null>(null);
  const previewedElementsRef = React.useRef<Map<string, { element: HTMLElement; originalStyle: string; wasHidden: boolean }>>(new Map());
  const splitTextInstancesRef = React.useRef<Map<string, SplitText>>(new Map());
  const isChangingPropertyRef = React.useRef(false);
  const pendingClearRAFsRef = React.useRef<number[]>([]); // Track pending RAF IDs to cancel them

  /** Get element from iframe by layer ID */
  const getIframeElement = useCallback((layerId: string): HTMLElement | null => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
    if (!iframeDoc) return null;
    return iframeDoc.querySelector(`[data-layer-id="${layerId}"]`) as HTMLElement;
  }, []);

  /** Get iframe's GSAP SplitText instance */
  const getIframeSplitText = useCallback((): typeof SplitText | null => {
    const iframe = document.querySelector('iframe') as HTMLIFrameElement;
    const iframeWindow = iframe?.contentWindow;
    if (!iframeWindow) {
      console.warn('Cannot access iframe window');
      return null;
    }

    // Access GSAP and SplitText from iframe's window
    const iframeGsap = (iframeWindow as any).gsap;
    const iframeSplitText = (iframeWindow as any).SplitText;

    if (!iframeGsap) {
      console.warn('GSAP not loaded in iframe');
      return null;
    }

    if (!iframeSplitText) {
      console.warn('SplitText not loaded in iframe');
      return null;
    }

    // Return a wrapper that creates SplitText instances in iframe context
    return iframeSplitText as typeof SplitText;
  }, []);

  /** Clear preview styles and restore original */
  const clearPreviewStyles = useCallback((force = false) => {
    // Skip if a property change is in progress (prevents blur during re-render)
    if (!force && isChangingPropertyRef.current) return;

    // Kill any running preview animation
    if (previewTweenRef.current) {
      previewTweenRef.current.kill();
      previewTweenRef.current = null;
    }

    if (previewedElementRef.current) {
      const { layerId, element, originalStyle, wasHidden } = previewedElementRef.current;

      // Revert any split text instance for this element (single property preview)
      const splitInstance = splitTextInstancesRef.current.get(layerId);
      if (splitInstance) {
        try {
          splitInstance.revert();
          splitTextInstancesRef.current.delete(layerId);
        } catch (error) {
          // Ignore revert errors
        }
      }

      // Use GSAP to clear transforms
      gsap.set(element, { clearProps: 'all' });
      element.setAttribute('style', originalStyle);
      // Restore original hidden state
      if (wasHidden) {
        element.setAttribute('data-gsap-hidden', '');
      } else {
        element.removeAttribute('data-gsap-hidden');
      }
      previewedElementRef.current = null;
    }
  }, []);

  /** Apply preview styles to a layer element using GSAP */
  const applyPreviewStyles = useCallback((layerId: string, properties: gsap.TweenVars, options?: { splitText?: { type: 'chars' | 'words' | 'lines'; stagger: { amount: number } }; duration?: number }) => {
    // Cancel any pending clear operations from blur events
    pendingClearRAFsRef.current.forEach(id => cancelAnimationFrame(id));
    pendingClearRAFsRef.current = [];

    const element = getIframeElement(layerId);
    if (!element) return;

    // Only store original style if this is a new preview or different layer
    if (!previewedElementRef.current || previewedElementRef.current.layerId !== layerId) {
      // Clear any existing preview for different element
      clearPreviewStyles();

      // Store original style and hidden state for the new element
      previewedElementRef.current = {
        layerId,
        element,
        originalStyle: element.getAttribute('style') || '',
        wasHidden: element.hasAttribute('data-gsap-hidden'),
      };
    }

    // If splitText is enabled, apply preview to split elements with stagger
    if (options?.splitText) {
      const IframeSplitText = getIframeSplitText();
      const iframeWindow = (document.querySelector('iframe') as HTMLIFrameElement)?.contentWindow;
      const iframeGsap = iframeWindow ? (iframeWindow as any).gsap : null;

      if (IframeSplitText && iframeGsap) {
        // Check if we already have a split instance for this element
        let splitInstance = splitTextInstancesRef.current.get(layerId);
        let splitElements: HTMLElement[] | undefined;

        if (!splitInstance) {
          // Create new split instance
          try {
            splitInstance = new IframeSplitText(element, {
              type: options.splitText.type,
            });
            const splitProperty = options.splitText.type === 'chars' ? 'chars' :
              options.splitText.type === 'words' ? 'words' : 'lines';
            splitElements = splitInstance[splitProperty] as HTMLElement[];

            if (splitElements && splitElements.length > 0) {
              splitTextInstancesRef.current.set(layerId, splitInstance);
            } else {
              splitInstance.revert();
              splitInstance = undefined;
            }
          } catch (error) {
            console.warn('Failed to create SplitText for preview:', error);
          }
        } else {
          // Use existing split elements
          const splitProperty = options.splitText.type === 'chars' ? 'chars' :
            options.splitText.type === 'words' ? 'words' : 'lines';
          splitElements = splitInstance[splitProperty] as HTMLElement[];
        }

        // Apply preview to split elements instantly (no stagger for instant preview)
        if (splitElements && splitElements.length > 0) {
          iframeGsap.set(splitElements, properties);
          return;
        }
      }
    }

    // Fallback: Use GSAP to set the preview state instantly on the element
    gsap.set(element, properties);
  }, [clearPreviewStyles, getIframeElement, getIframeSplitText]);

  /** Clear all preview styles from timeline playback */
  const clearAllPreviewStyles = useCallback(() => {
    // Cancel any pending clear operations from blur events
    pendingClearRAFsRef.current.forEach(id => cancelAnimationFrame(id));
    pendingClearRAFsRef.current = [];

    // Kill any running timeline
    if (previewTimelineRef.current) {
      previewTimelineRef.current.kill();
      previewTimelineRef.current = null;
    }

    // Revert all SplitText instances
    splitTextInstancesRef.current.forEach((splitInstance) => {
      try {
        splitInstance.revert();
      } catch (error) {
        // Ignore errors if revert fails (element might be removed)
        console.warn('Failed to revert SplitText:', error);
      }
    });
    splitTextInstancesRef.current.clear();

    // Restore all previewed elements
    previewedElementsRef.current.forEach(({ element, originalStyle, wasHidden }) => {
      gsap.set(element, { clearProps: 'all' });
      element.setAttribute('style', originalStyle);
      // Restore original hidden state
      if (wasHidden) {
        element.setAttribute('data-gsap-hidden', '');
      } else {
        element.removeAttribute('data-gsap-hidden');
      }
    });
    previewedElementsRef.current.clear();

    // Also clear single element preview
    clearPreviewStyles(true);
  }, [clearPreviewStyles]);

  /** Play a tween animation preview */
  const playTweenPreview = useCallback((
    layerId: string,
    from: gsap.TweenVars,
    to: gsap.TweenVars,
    duration: number,
    ease: string,
    displayStart: string | null,
    displayEnd: string | null,
    splitTextConfig?: { type: 'chars' | 'words' | 'lines'; stagger: { amount: number } }
  ) => {
    // Clear any existing preview first (force clear)
    clearAllPreviewStyles();

    const element = getIframeElement(layerId);
    if (!element) return;

    // Get iframe's GSAP instance - MUST use iframe's gsap for consistency with SplitText
    const iframeWindow = (document.querySelector('iframe') as HTMLIFrameElement)?.contentWindow;
    const iframeGsap = iframeWindow ? (iframeWindow as any).gsap : null;
    const IframeSplitText = getIframeSplitText();

    if (!iframeGsap) {
      console.warn('GSAP not available in iframe');
      return;
    }

    // Store original style and hidden state
    previewedElementRef.current = {
      layerId,
      element,
      originalStyle: element.getAttribute('style') || '',
      wasHidden: element.hasAttribute('data-gsap-hidden'),
    };

    // Apply split text if configured using GSAP's SplitText
    let effectiveSplitTextConfig = splitTextConfig;
    let splitElements: HTMLElement[] | undefined;
    if (splitTextConfig) {
      // Revert any existing SplitText instance for this element
      const existingSplit = splitTextInstancesRef.current.get(layerId);
      if (existingSplit) {
        try {
          existingSplit.revert();
        } catch (error) {
          // Ignore errors if revert fails
          console.warn('Failed to revert existing SplitText:', error);
        }
      }

      if (!IframeSplitText) {
        console.warn('GSAP SplitText not available in iframe');
        effectiveSplitTextConfig = undefined;
      } else {
        // Create a temporary tween object for the utility function
        const tempTween: InteractionTween = {
          id: '',
          layer_id: layerId,
          position: 0,
          duration,
          ease,
          from: from as any,
          to: to as any,
          apply_styles: {} as any,
          splitText: splitTextConfig,
        };

        const result = createSplitTextAnimation(
          element,
          splitTextConfig,
          tempTween,
          iframeGsap,
          IframeSplitText
        );

        if (result) {
          splitTextInstancesRef.current.set(layerId, result.splitInstance);
          splitElements = result.splitElements;
        } else {
          effectiveSplitTextConfig = undefined;
        }
      }
    }

    // Handle display via data-gsap-hidden attribute (same as AnimationInitializer)
    // 'visible' = remove attribute, 'hidden' = add attribute
    if (displayStart === 'visible') {
      element.removeAttribute('data-gsap-hidden');
    }

    // Play the animation using iframe's GSAP (same context as SplitText)
    const tl = iframeGsap.timeline({
      onComplete: () => {
        if (displayEnd === 'hidden') {
          element.setAttribute('data-gsap-hidden', '');
        }
      },
    });

    addTweenToTimeline(tl, {
      element,
      from,
      to,
      duration,
      ease,
      position: 0,
      splitText: effectiveSplitTextConfig,
      splitElements,
    });

    previewTweenRef.current = tl as unknown as gsap.core.Tween;
  }, [clearAllPreviewStyles, getIframeElement, getIframeSplitText]);

  // Drag and drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Reset selections and clear GSAP previews when trigger layer changes or reset is triggered
  useEffect(() => {
    setSelectedInteractionId(null);
    setSelectedTweenId(null);
    clearAllPreviewStyles();
  }, [triggerLayer.id, resetKey, clearAllPreviewStyles]);

  // Cleanup GSAP animations on unmount (when exiting interaction tab)
  useEffect(() => {
    // Capture refs for cleanup
    const tweenRef = previewTweenRef;
    const timelineRef = previewTimelineRef;
    const elementRef = previewedElementRef;
    const elementsRef = previewedElementsRef;
    const pendingClearRAFsRefCopy = pendingClearRAFsRef;

    return () => {
      // Cancel any pending RAF clear operations
      pendingClearRAFsRefCopy.current.forEach(id => cancelAnimationFrame(id));
      pendingClearRAFsRefCopy.current = [];

      // Kill any running preview animation
      if (tweenRef.current) {
        tweenRef.current.kill();
        tweenRef.current = null;
      }
      // Kill any running timeline
      if (timelineRef.current) {
        timelineRef.current.kill();
        timelineRef.current = null;
      }
      // Restore original styles (single element)
      if (elementRef.current) {
        const { element, originalStyle } = elementRef.current;
        gsap.set(element, { clearProps: 'all' });
        element.setAttribute('style', originalStyle);
        elementRef.current = null;
      }
      // Restore all previewed elements (from timeline)
      elementsRef.current.forEach(({ element, originalStyle }) => {
        gsap.set(element, { clearProps: 'all' });
        element.setAttribute('style', originalStyle);
      });
      elementsRef.current.clear();
    };
  }, []);

  // Memoize interactions to prevent unnecessary re-renders
  const interactions = useMemo(() => triggerLayer.interactions || [], [triggerLayer.interactions]);
  const selectedInteraction = interactions.find((i) => i.id === selectedInteractionId);
  const usedTriggers = useMemo(() => new Set(interactions.map(i => i.trigger)), [interactions]);

  // Find selected tween
  const selectedTween =
    selectedInteraction && selectedTweenId
      ? (selectedInteraction.tweens || []).find((t) => t.id === selectedTweenId) || null
      : null;

  // Derived primitive values for syncing local time input state
  const syncTweenId = selectedTween?.id;
  const syncTweenDuration = selectedTween?.duration;
  const syncTweenPosition = selectedTween?.position;
  const syncTweenStagger = selectedTween?.splitText?.stagger?.amount;

  // Sync local time input state when switching tweens or values change externally (e.g. stepper)
  useEffect(() => {
    if (syncTweenId === undefined) return;
    setDurationInput(String(syncTweenDuration ?? 0));
    if (typeof syncTweenPosition === 'number') {
      setPositionInput(String(syncTweenPosition));
    }
    if (syncTweenStagger !== undefined) {
      setStaggerInput(String(syncTweenStagger));
    }
  }, [syncTweenId, syncTweenDuration, syncTweenPosition, syncTweenStagger]);

  /** Play all animations in the selected interaction as a timeline */
  const playAllAnimations = useCallback(() => {
    if (!selectedInteraction) return;

    const tweens = selectedInteraction.tweens || [];
    if (tweens.length === 0) return;

    // Clear any existing previews first
    clearAllPreviewStyles();

    // Get iframe's GSAP instance - MUST use iframe's gsap for consistency with SplitText
    const iframeWindow = (document.querySelector('iframe') as HTMLIFrameElement)?.contentWindow;
    const iframeGsap = iframeWindow ? (iframeWindow as any).gsap : null;
    const IframeSplitText = getIframeSplitText();

    if (!iframeGsap) {
      console.warn('GSAP not available in iframe');
      return;
    }

    // Create timeline using iframe's GSAP to ensure same context as SplitText
    const timeline = iframeGsap.timeline({});

    // Cache split elements to reuse across multiple tweens on the same element
    const splitElementsCache = new Map<string, HTMLElement[]>();

    // First pass: prepare all elements, split text, and collect initial states
    // This ensures all initial "from" states are applied at time 0
    interface PreparedTween {
      tween: InteractionTween;
      element: HTMLElement;
      splitElements?: HTMLElement[];
      effectiveSplitText?: typeof tweens[0]['splitText'];
      fromProps: gsap.TweenVars;
      toProps: gsap.TweenVars;
      displayStart: string | null;
      displayEnd: string | null;
      position: string | number;
    }
    const preparedTweens: PreparedTween[] = [];

    tweens.forEach((tween, index) => {
      const element = getIframeElement(tween.layer_id);
      if (!element) return;

      // Store original style and hidden state if not already stored
      if (!previewedElementsRef.current.has(tween.layer_id)) {
        previewedElementsRef.current.set(tween.layer_id, {
          element,
          originalStyle: element.getAttribute('style') || '',
          wasHidden: element.hasAttribute('data-gsap-hidden'),
        });
      }

      // Apply split text if configured using GSAP's SplitText
      let effectiveSplitText = tween.splitText;
      let splitElements: HTMLElement[] | undefined;
      if (tween.splitText) {
        // Check if we've already split this element in this timeline
        const cacheKey = `${tween.layer_id}_${tween.splitText.type}`;

        if (splitElementsCache.has(cacheKey)) {
          // Reuse existing split elements (do NOT revert - keep same instance)
          splitElements = splitElementsCache.get(cacheKey);
          effectiveSplitText = tween.splitText;
        } else {
          // First tween with this split config - create new SplitText
          // Revert any existing SplitText instance from previous timeline playback
          const existingSplit = splitTextInstancesRef.current.get(tween.layer_id);
          if (existingSplit) {
            try {
              existingSplit.revert();
            } catch (error) {
              console.warn('Failed to revert existing SplitText:', error);
            }
          }

          if (!IframeSplitText) {
            console.warn('GSAP SplitText not available in iframe');
            effectiveSplitText = undefined;
          } else {
            const result = createSplitTextAnimation(
              element,
              tween.splitText,
              tween,
              iframeGsap,
              IframeSplitText
            );

            if (result) {
              splitTextInstancesRef.current.set(tween.layer_id, result.splitInstance);
              splitElements = result.splitElements;
              // Cache for reuse within this timeline
              splitElementsCache.set(cacheKey, result.splitElements);
            } else {
              effectiveSplitText = undefined;
            }
          }
        }
      }

      // Build from/to props
      const { from: fromProps, to: toProps, displayStart, displayEnd } = buildGsapProps(tween);

      // Calculate position for timeline
      let position: string | number = 0;
      if (typeof tween.position === 'number') {
        position = tween.position;
      } else if (tween.position === '>' && index > 0) {
        position = '>'; // After previous
      } else if (tween.position === '<' && index > 0) {
        position = '<'; // With previous
      }

      preparedTweens.push({
        tween,
        element,
        splitElements,
        effectiveSplitText,
        fromProps,
        toProps,
        displayStart,
        displayEnd,
        position,
      });
    });

    // Second pass: Add all tweens to timeline
    // For each tween, apply its "from" state at the same position it starts
    preparedTweens.forEach(({ element, splitElements, effectiveSplitText, fromProps, toProps, displayStart, displayEnd, tween, position }) => {
      // Apply the "from" state at the same position as the tween starts
      // This ensures sequenced animations have correct initial state when they begin
      if (Object.keys(fromProps).length > 0) {
        const targets = splitElements && splitElements.length > 0 ? splitElements : element;
        timeline.set(targets, fromProps, position);
      }
      // Handle display via data-gsap-hidden attribute (same as AnimationInitializer)
      if (displayStart === 'visible') {
        timeline.call(() => element.removeAttribute('data-gsap-hidden'), undefined, position);
      }

      // Add tween to timeline using shared utility
      addTweenToTimeline(timeline, {
        element,
        from: fromProps,
        to: toProps,
        duration: tween.duration,
        ease: tween.ease,
        position,
        splitText: effectiveSplitText,
        splitElements,
        onComplete: displayEnd === 'hidden'
          ? () => element.setAttribute('data-gsap-hidden', '')
          : undefined,
      });
    });

    previewTimelineRef.current = timeline;
  }, [selectedInteraction, getIframeElement, clearAllPreviewStyles, getIframeSplitText]);

  // Find layers that animate the current trigger layer (where this layer is a target in tweens)
  const animatedByLayers = useMemo(() => {
    const result: Array<{ layer: Layer; triggerType: TriggerType }> = [];

    const findAnimators = (layers: Layer[]) => {
      layers.forEach((layer) => {
        // Skip self
        if (layer.id === triggerLayer.id) {
          if (layer.children) findAnimators(layer.children);
          return;
        }

        const layerInteractions = layer.interactions || [];
        // Find the first interaction that has a tween targeting this layer
        const matchingInteraction = layerInteractions.find((interaction) =>
          (interaction.tweens || []).some((tween) => tween.layer_id === triggerLayer.id)
        );

        if (matchingInteraction) {
          result.push({ layer, triggerType: matchingInteraction.trigger });
        }

        if (layer.children) {
          findAnimators(layer.children);
        }
      });
    };

    findAnimators(allLayers);
    return result;
  }, [allLayers, triggerLayer.id]);

  // Auto-select first tween's target layer when a trigger event is selected (only on ID change)
  useEffect(() => {
    if (selectedInteractionId) {
      const interaction = interactions.find((i) => i.id === selectedInteractionId);
      const firstTween = (interaction?.tweens || [])[0];
      if (firstTween && onSelectLayer) {
        const targetLayer = findLayerById(allLayers, firstTween.layer_id);
        if (targetLayer) {
          onSelectLayer(targetLayer.id);
        }
      }
    }
    // Only run when selectedInteractionId changes, not when interaction content changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedInteractionId]);

  // Notify parent about state changes
  useEffect(() => {
    onStateChange?.({
      selectedTriggerId: selectedInteractionId,
    });
  }, [selectedInteractionId, onStateChange]);

  // Add new interaction
  const handleAddInteraction = useCallback(
    (trigger: TriggerType) => {
      const newInteraction: LayerInteraction = {
        id: generateId('int'),
        trigger,
        timeline: {
          breakpoints: [...BREAKPOINT_VALUES], // All breakpoints by default
          repeat: 0,
          yoyo: false,
          // Add scroll-specific defaults
          ...(trigger === 'scroll-into-view' && {
            scrollStart: 'top 80%',
            toggleActions: 'play none none none',
          }),
          ...(trigger === 'while-scrolling' && {
            scrollStart: 'top bottom',
            scrollEnd: 'bottom top',
            scrub: 1,
          }),
        },
        tweens: [], // Start with no tweens - user will add them
      };

      const updatedInteractions = [...interactions, newInteraction];
      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
      setSelectedInteractionId(newInteraction.id);
    },
    [interactions, triggerLayer.id, onLayerUpdate]
  );

  // Remove interaction
  const handleRemoveInteraction = useCallback(
    (interactionId: string) => {
      const updatedInteractions = interactions.filter((i) => i.id !== interactionId);
      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });

      if (selectedInteractionId === interactionId) {
        setSelectedInteractionId(null);
      }

      // Select trigger layer when last interaction is removed
      if (updatedInteractions.length === 0 && onSelectLayer) {
        onSelectLayer(triggerLayer.id);
      }
    },
    [interactions, triggerLayer.id, onLayerUpdate, selectedInteractionId, onSelectLayer]
  );

  // Update Interaction settings (now at interaction level)
  const handleUpdateTimeline = useCallback(
    (updates: Partial<InteractionTimeline>) => {
      if (!selectedInteraction) return;

      const updatedInteractions = updateInteractionById(
        interactions,
        selectedInteractionId!,
        (interaction) => ({
          ...interaction,
          timeline: { ...interaction.timeline, ...updates },
        })
      );

      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
    },
    [selectedInteraction, interactions, selectedInteractionId, triggerLayer.id, onLayerUpdate]
  );

  // Add new tween for the currently selected layer
  const handleAddTween = useCallback(() => {
    if (!selectedInteraction || !selectedLayerId) return;

    const newTween: InteractionTween = {
      id: generateId('anm'),
      layer_id: selectedLayerId,
      position: '>',
      duration: 0.3,
      ease: 'power1.out',
      from: {},
      to: {},
      apply_styles: {
        x: 'on-trigger',
        y: 'on-trigger',
        rotation: 'on-trigger',
        scale: 'on-trigger',
        skewX: 'on-trigger',
        skewY: 'on-trigger',
        autoAlpha: 'on-trigger',
        display: 'on-trigger',
      },
    };

    const updatedInteractions = updateInteractionById(
      interactions,
      selectedInteractionId!,
      (interaction) => updateInteractionTweens(interaction, (tweens) => [...tweens, newTween])
    );

    onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
    setSelectedTweenId(newTween.id);
  }, [selectedInteraction, selectedLayerId, interactions, selectedInteractionId, triggerLayer.id, onLayerUpdate]);

  // Remove tween
  const handleRemoveTween = useCallback(
    (tweenId: string) => {
      if (!selectedInteraction) return;

      const updatedInteractions = updateInteractionById(
        interactions,
        selectedInteractionId!,
        (interaction) => updateInteractionTweens(interaction, (tweens) => tweens.filter((t) => t.id !== tweenId))
      );

      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
      if (selectedTweenId === tweenId) {
        setSelectedTweenId(null);
      }
    },
    [selectedInteraction, interactions, selectedInteractionId, triggerLayer.id, onLayerUpdate, selectedTweenId]
  );

  // Reorder tweens via drag and drop
  const handleReorderTweens = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id || !selectedInteraction) return;

      const tweens = selectedInteraction.tweens || [];
      const oldIndex = tweens.findIndex((t) => t.id === active.id);
      const newIndex = tweens.findIndex((t) => t.id === over.id);

      if (oldIndex === -1 || newIndex === -1) return;

      const reorderedTweens = arrayMove(tweens, oldIndex, newIndex);

      const updatedInteractions = updateInteractionById(
        interactions,
        selectedInteractionId!,
        (interaction) => ({ ...interaction, tweens: reorderedTweens })
      );

      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
    },
    [selectedInteraction, interactions, selectedInteractionId, triggerLayer.id, onLayerUpdate]
  );

  // Update tween
  const handleUpdateTween = useCallback(
    (tweenId: string, updates: Partial<InteractionTween>) => {
      if (!selectedInteraction) return;

      const updatedInteractions = updateInteractionById(
        interactions,
        selectedInteractionId!,
        (interaction) => updateInteractionTweens(
          interaction,
          (tweens) => updateTweenById(tweens, tweenId, (tween) => ({ ...tween, ...updates }))
        )
      );

      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
    },
    [selectedInteraction, interactions, selectedInteractionId, triggerLayer.id, onLayerUpdate]
  );

  // Add property to tween
  const handleAddPropertyToTween = useCallback(
    (tweenId: string, propertyType: PropertyType) => {
      if (!selectedInteraction) return;

      const propertyOption = PROPERTY_OPTIONS.find((p) => p.type === propertyType);
      if (!propertyOption) return;

      const updatedInteractions = updateInteractionById(
        interactions,
        selectedInteractionId!,
        (interaction) => updateInteractionTweens(
          interaction,
          (tweens) => updateTweenById(tweens, tweenId, (tween) => {
            const newFrom: TweenProperties = { ...tween.from };
            const newTo: TweenProperties = { ...tween.to };
            propertyOption.properties.forEach((prop) => {
              (newFrom[prop.key] as string | null) = prop.defaultFrom;
              (newTo[prop.key] as string | null) = prop.defaultTo;
            });
            return { ...tween, from: newFrom, to: newTo };
          })
        )
      );

      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
    },
    [selectedInteraction, interactions, selectedInteractionId, triggerLayer.id, onLayerUpdate]
  );

  // Remove property from tween
  const handleRemovePropertyFromTween = useCallback(
    (tweenId: string, propertyType: PropertyType) => {
      if (!selectedInteraction) return;

      const propertyOption = PROPERTY_OPTIONS.find((p) => p.type === propertyType);
      if (!propertyOption) return;

      const updatedInteractions = updateInteractionById(
        interactions,
        selectedInteractionId!,
        (interaction) => updateInteractionTweens(
          interaction,
          (tweens) => updateTweenById(tweens, tweenId, (tween) => {
            const newFrom = { ...tween.from };
            const newTo = { ...tween.to };
            propertyOption.properties.forEach((prop) => {
              delete newFrom[prop.key];
              delete newTo[prop.key];
            });
            return { ...tween, from: newFrom, to: newTo };
          })
        )
      );

      onLayerUpdate(triggerLayer.id, { interactions: updatedInteractions });
    },
    [selectedInteraction, interactions, selectedInteractionId, triggerLayer.id, onLayerUpdate]
  );

  // Toggle breakpoint in timeline
  const handleToggleBreakpoint = useCallback(
    (breakpoint: Breakpoint) => {
      if (!selectedInteraction) return;

      const currentBreakpoints = selectedInteraction.timeline?.breakpoints || [];
      const newBreakpoints = currentBreakpoints.includes(breakpoint)
        ? currentBreakpoints.filter((b) => b !== breakpoint)
        : [...currentBreakpoints, breakpoint];

      // Ensure at least one breakpoint is selected
      if (newBreakpoints.length === 0) return;

      handleUpdateTimeline({ breakpoints: newBreakpoints });
    },
    [selectedInteraction, handleUpdateTimeline]
  );

  // Check if there's an active trigger (different layer selected or target selected)
  const hasActiveTrigger = selectedInteractionId !== null;

  return (
    <div className="flex flex-col">
      {/* Trigger Layer */}
      <div className="flex items-center gap-2 my-2">
        {onStateChange && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="secondary"
                disabled={!hasActiveTrigger}
                onClick={() => onStateChange({ shouldRefresh: true })}
              >
                <Icon name="undo" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Switch to a different trigger element</TooltipContent>
          </Tooltip>
        )}

        <div
          onClick={() => onSelectLayer?.(triggerLayer.id)}
          className={cn('flex-1 flex items-center gap-2 px-2 py-1.75 rounded-lg transition-colors cursor-pointer bg-secondary/50 hover:bg-secondary')}
        >
          <div className={cn('size-5 flex items-center justify-center rounded-[6px] bg-secondary/50 hover:bg-secondary')}>
            <Icon name={getLayerIcon(triggerLayer)} className="size-2.5" />
          </div>
          <Label variant="muted" className="cursor-pointer">
            {getLayerName(triggerLayer)}
          </Label>
        </div>
      </div>

      {/* Trigger Events Header */}
      <header className="py-5 flex justify-between -mt-2">
        <span className="font-medium">Trigger events</span>
        <div className="-my-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="xs" variant="secondary">
                <Icon name="plus" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="mr-4">
              <DropdownMenuItem onClick={() => handleAddInteraction('click')} disabled={usedTriggers.has('click')}>Click</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddInteraction('hover')} disabled={usedTriggers.has('hover')}>Hover</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddInteraction('scroll-into-view')} disabled={usedTriggers.has('scroll-into-view')}>Scroll into view</DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleAddInteraction('while-scrolling')} disabled={usedTriggers.has('while-scrolling')}>While scrolling</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => handleAddInteraction('load')} disabled={usedTriggers.has('load')}>Page load</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      {/* Interaction List */}
      {interactions.length === 0 ? (
        <Empty>
          <EmptyDescription>
            Add a trigger event to start an interaction.
          </EmptyDescription>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {interactions.map((interaction) => (
            <div
              key={interaction.id}
              onClick={() => {
                setSelectedInteractionId(interaction.id);
              }}
              className={cn(
                'flex items-center gap-2 px-2 py-1.75 rounded-lg transition-colors text-left w-full cursor-pointer',
                selectedInteractionId === interaction.id
                  ? 'bg-teal-500/50 text-primary-foreground'
                  : 'bg-secondary/50 hover:bg-secondary'
              )}
            >
              <div
                className={cn(
                  'size-5 flex items-center justify-center rounded-[6px]',
                  selectedInteractionId === interaction.id
                    ? 'bg-primary-foreground/20'
                    : 'bg-secondary'
                )}
              >
                <Icon name="zap" className="size-2.5" />
              </div>

              <Label
                variant={selectedInteractionId === interaction.id ? 'default' : 'muted'}
                className="cursor-pointer"
              >
                {TRIGGER_LABELS[interaction.trigger]}
              </Label>

              <div className="ml-auto -my-1 -mr-0.5">
                <Button
                  size="xs"
                  variant="ghost"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleRemoveInteraction(interaction.id);
                  }}
                >
                  <Icon name="x" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Animated By Section - Show when no trigger is selected and this layer is animated by others */}
      {!hasActiveTrigger && animatedByLayers.length > 0 && (
        <div className="mt-4 border-t">
          <header className="py-5">
            <span className="font-medium">This layer is animated by</span>
          </header>

          <div className="flex flex-col gap-2">
            {animatedByLayers.map(({ layer, triggerType }) => (
              <div
                key={layer.id}
                onClick={() => onSelectLayer?.(layer.id)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-lg transition-colors cursor-pointer bg-secondary/50 hover:bg-secondary"
              >
                <div className="size-5 flex items-center justify-center rounded-[6px] bg-secondary">
                  <Icon name={getLayerIcon(layer)} className="size-2.5" />
                </div>

                <Label variant="muted" className="cursor-pointer">
                  {getLayerName(layer)}
                </Label>

                <Badge variant="secondary" className="ml-auto">
                  {TRIGGER_LABELS[triggerType]}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Interaction settings - Show when interaction is selected */}
      {selectedInteraction && (
        <div className="border-t">
          <header className="py-5 flex justify-between">
            <span className="font-medium">Interaction settings</span>
          </header>

          <div className="flex flex-col gap-2 pb-4">
            {/* Breakpoints */}
            <div className="grid grid-cols-3 items-center">
              <Label variant="muted">Run on</Label>
              <div className="col-span-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="secondary"
                      size="sm"
                      className="w-full justify-between"
                    >
                      <span>
                        {(selectedInteraction.timeline?.breakpoints?.length ?? 0) === BREAKPOINTS.length
                          ? 'All breakpoints'
                          : selectedInteraction.timeline?.breakpoints
                            ?.map(bp => BREAKPOINTS.find(b => b.value === bp)?.label || bp)
                            .join(', ') || 'No breakpoints'}
                      </span>
                      <Icon name="chevronCombo" className="size-3 opacity-50" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40">
                    {BREAKPOINTS.map((bp) => (
                      <DropdownMenuCheckboxItem
                        key={bp.value}
                        checked={selectedInteraction.timeline?.breakpoints?.includes(bp.value) ?? false}
                        onCheckedChange={() => handleToggleBreakpoint(bp.value)}
                      >
                        {bp.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Loop - only show for non-scroll triggers */}
            {['click', 'hover'].includes(selectedInteraction.trigger) && (
              <div className="grid grid-cols-3 items-center">
                <Label variant="muted">Effect</Label>
                <div className="col-span-2">
                  <Select
                    value={
                      (selectedInteraction.timeline?.repeat ?? 0) === 0
                        ? selectedInteraction.timeline?.yoyo ? 'reverse' : 'reset'
                        : selectedInteraction.timeline?.yoyo ? 'loop-reverse' : 'loop'
                    }
                    onValueChange={(value: 'reset' | 'reverse' | 'loop' | 'loop-reverse') => {
                      if (value === 'reset') {
                        handleUpdateTimeline({ repeat: 0, yoyo: false });
                      } else if (value === 'reverse') {
                        handleUpdateTimeline({ repeat: 0, yoyo: true });
                      } else if (value === 'loop') {
                        handleUpdateTimeline({ repeat: -1, yoyo: false });
                      } else if (value === 'loop-reverse') {
                        handleUpdateTimeline({ repeat: -1, yoyo: true });
                      }
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="reset">Reset and run once</SelectItem>
                      <SelectItem value="reverse">Toggle and run once</SelectItem>
                      <SelectItem value="loop">Loop - Reset and restart</SelectItem>
                      <SelectItem value="loop-reverse">Loop - Toggle and restart</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {/* Scroll Settings - show for scroll-into-view and while-scrolling */}
            {(selectedInteraction.trigger === 'scroll-into-view' || selectedInteraction.trigger === 'while-scrolling') && (
              <>
                {/* Start Position - values read directly from layer data */}
                <div className="grid grid-cols-3 items-center">
                  <div className="flex items-center gap-1.5">
                    <Label variant="muted">Start</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Icon name="info" className="size-3 opacity-70" />
                      </TooltipTrigger>
                      <TooltipContent align="start">Position of: Trigger layer / Viewport</TooltipContent>
                    </Tooltip>
                  </div>
                  <div className="col-span-2 grid grid-cols-2 gap-1.5">
                    <Select
                      value={selectedInteraction.timeline?.scrollStart?.split(' ')[0] || 'top'}
                      onValueChange={(elementPos) => {
                        const currentStart = selectedInteraction.timeline?.scrollStart || 'top bottom';
                        const viewportPos = currentStart.split(' ')[1] || 'bottom';
                        handleUpdateTimeline({ scrollStart: `${elementPos} ${viewportPos}` });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="top">Top</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="bottom">Bottom</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select
                      value={selectedInteraction.timeline?.scrollStart?.split(' ')[1] || 'bottom'}
                      onValueChange={(viewportPos) => {
                        const currentStart = selectedInteraction.timeline?.scrollStart || 'top bottom';
                        const elementPos = currentStart.split(' ')[0] || 'top';
                        handleUpdateTimeline({ scrollStart: `${elementPos} ${viewportPos}` });
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent align="end">
                        <SelectItem value="top">Top</SelectItem>
                        <SelectItem value="5%">5%</SelectItem>
                        <SelectItem value="10%">10%</SelectItem>
                        <SelectItem value="15%">15%</SelectItem>
                        <SelectItem value="20%">20%</SelectItem>
                        <SelectItem value="25%">25%</SelectItem>
                        <SelectItem value="30%">30%</SelectItem>
                        <SelectItem value="35%">35%</SelectItem>
                        <SelectItem value="40%">40%</SelectItem>
                        <SelectItem value="45%">45%</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="55%">55%</SelectItem>
                        <SelectItem value="60%">60%</SelectItem>
                        <SelectItem value="65%">65%</SelectItem>
                        <SelectItem value="70%">70%</SelectItem>
                        <SelectItem value="75%">75%</SelectItem>
                        <SelectItem value="80%">80%</SelectItem>
                        <SelectItem value="85%">85%</SelectItem>
                        <SelectItem value="90%">90%</SelectItem>
                        <SelectItem value="95%">95%</SelectItem>
                        <SelectItem value="bottom">Bottom</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {selectedInteraction.trigger === 'while-scrolling' && (
                  <>
                    {/* End Position - values read directly from layer data */}
                    <div className="grid grid-cols-3 items-center">
                      <div className="flex items-center gap-1.5">
                        <Label variant="muted">End</Label>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Icon name="info" className="size-3 opacity-70" />
                          </TooltipTrigger>
                          <TooltipContent align="start">Position of: Trigger layer / Viewport</TooltipContent>
                        </Tooltip>
                      </div>
                      <div className="col-span-2 grid grid-cols-2 gap-1.5">
                        <Select
                          value={selectedInteraction.timeline?.scrollEnd?.split(' ')[0] || 'bottom'}
                          onValueChange={(elementPos) => {
                            const currentEnd = selectedInteraction.timeline?.scrollEnd || 'bottom top';
                            const viewportPos = currentEnd.split(' ')[1] || 'top';
                            handleUpdateTimeline({ scrollEnd: `${elementPos} ${viewportPos}` });
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="top">Top</SelectItem>
                            <SelectItem value="center">Center</SelectItem>
                            <SelectItem value="bottom">Bottom</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select
                          value={selectedInteraction.timeline?.scrollEnd?.split(' ')[1] || 'top'}
                          onValueChange={(viewportPos) => {
                            const currentEnd = selectedInteraction.timeline?.scrollEnd || 'bottom top';
                            const elementPos = currentEnd.split(' ')[0] || 'bottom';
                            handleUpdateTimeline({ scrollEnd: `${elementPos} ${viewportPos}` });
                          }}
                        >
                          <SelectTrigger className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="end">
                            <SelectItem value="top">Top</SelectItem>
                            <SelectItem value="5%">5%</SelectItem>
                            <SelectItem value="10%">10%</SelectItem>
                            <SelectItem value="15%">15%</SelectItem>
                            <SelectItem value="20%">20%</SelectItem>
                            <SelectItem value="25%">25%</SelectItem>
                            <SelectItem value="30%">30%</SelectItem>
                            <SelectItem value="35%">35%</SelectItem>
                            <SelectItem value="40%">40%</SelectItem>
                            <SelectItem value="45%">45%</SelectItem>
                            <SelectItem value="center">Center</SelectItem>
                            <SelectItem value="55%">55%</SelectItem>
                            <SelectItem value="60%">60%</SelectItem>
                            <SelectItem value="65%">65%</SelectItem>
                            <SelectItem value="70%">70%</SelectItem>
                            <SelectItem value="75%">75%</SelectItem>
                            <SelectItem value="80%">80%</SelectItem>
                            <SelectItem value="85%">85%</SelectItem>
                            <SelectItem value="90%">90%</SelectItem>
                            <SelectItem value="95%">95%</SelectItem>
                            <SelectItem value="bottom">Bottom</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {/* Smoothing Slider */}
                    <div className="grid grid-cols-3 items-center">
                      <Label variant="muted">Smoothing</Label>
                      <div className="h-7 col-span-2 flex items-center">
                        <Slider
                          value={[typeof selectedInteraction.timeline?.scrub === 'number' ? selectedInteraction.timeline.scrub : (selectedInteraction.timeline?.scrub === true ? 0 : 1)]}
                          min={0}
                          max={2}
                          step={0.1}
                          onValueChange={([value]) => {
                            handleUpdateTimeline({ scrub: value === 0 ? true : value });
                          }}
                          className="flex-1"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {typeof selectedInteraction.timeline?.scrub === 'number'
                            ? `${selectedInteraction.timeline.scrub}s`
                            : selectedInteraction.timeline?.scrub === true ? '0s' : '1s'}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {/* Toggle Actions - only show for scroll-into-view */}
            {selectedInteraction.trigger === 'scroll-into-view' && (
              <>
                {(() => {
                  const toggleActions = selectedInteraction.timeline?.toggleActions || 'play none none none';
                  const [onEnter, onLeave, onEnterBack, onLeaveBack] = toggleActions.split(' ');

                  const updateToggleAction = (index: number, value: string) => {
                    const actions = toggleActions.split(' ');
                    actions[index] = value;
                    handleUpdateTimeline({ toggleActions: actions.join(' ') });
                  };

                  return (
                    <>
                      <Separator className="my-1.5" />

                      {/* Row 1: On trigger + On trigger back */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <Label variant="muted">On trigger</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Icon name="info" className="size-3 opacity-70" />
                              </TooltipTrigger>
                              <TooltipContent align="start">When triggered by scrolling down</TooltipContent>
                            </Tooltip>
                          </div>
                          <Select
                            value={onEnter}
                            onValueChange={(value) => updateToggleAction(0, value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TOGGLE_ACTION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <Label variant="muted">On re-trigger</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Icon name="info" className="size-3 opacity-70" />
                              </TooltipTrigger>
                              <TooltipContent align="start">When triggered by scrolling up</TooltipContent>
                            </Tooltip>
                          </div>
                          <Select
                            value={onLeaveBack}
                            onValueChange={(value) => updateToggleAction(3, value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TOGGLE_ACTION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>

                      {/* Row 2: On leave + On enter back */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <Label variant="muted">On VP leave</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Icon name="info" className="size-3 opacity-70" />
                              </TooltipTrigger>
                              <TooltipContent align="start">Trigger leaves the ViewPort (top side)</TooltipContent>
                            </Tooltip>
                          </div>
                          <Select
                            value={onLeave}
                            onValueChange={(value) => updateToggleAction(1, value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TOGGLE_ACTION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>

                        <div className="flex flex-col gap-1.5">
                          <div className="flex items-center gap-1.5">
                            <Label variant="muted">On VP re-enter</Label>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Icon name="info" className="size-3 opacity-70" />
                              </TooltipTrigger>
                              <TooltipContent align="start">Trigger re-enters the ViewPort (top side)</TooltipContent>
                            </Tooltip>
                          </div>
                          <Select
                            value={onEnterBack}
                            onValueChange={(value) => updateToggleAction(2, value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {TOGGLE_ACTION_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </>
                  );
                })()}
              </>
            )}
          </div>
        </div>
      )}

      {/* Tweens Section - Show when interaction is selected */}
      {selectedInteraction && (
        <div className="border-t">
          <header className="py-5 flex justify-between">
            <span className="font-medium">Animations</span>
            <div className="-my-1 flex gap-1">
              {(() => {
                const hasAnimationsWithProperties = (selectedInteraction.tweens || []).some(
                  (tween) => getTweenProperties(tween).length > 0
                );
                return (
                  <>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="xs"
                          variant="secondary"
                          className="size-6 p-0"
                          onClick={playAllAnimations}
                          disabled={!hasAnimationsWithProperties}
                        >
                          <Icon name="play" className="size-2.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Play all animations</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          size="xs"
                          variant="secondary"
                          className="size-6 p-0"
                          onClick={clearAllPreviewStyles}
                          disabled={!hasAnimationsWithProperties}
                        >
                          <Icon name="stop" className="size-2.5" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Reset all animations</TooltipContent>
                    </Tooltip>
                  </>
                );
              })()}
              <Button
                size="xs"
                variant="secondary"
                onClick={handleAddTween}
                disabled={!selectedLayerId}
              >
                <Icon name="plus" />
              </Button>
            </div>
          </header>

          {(selectedInteraction.tweens || []).length === 0 ? (
            <Empty>
              <EmptyDescription>
                Select a layer and add an animation.
              </EmptyDescription>
            </Empty>
          ) : (
            <div className="pb-4">
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                modifiers={[restrictToParentElement]}
                onDragEnd={handleReorderTweens}
              >
                <SortableContext
                  items={(selectedInteraction.tweens || []).map((t) => t.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="flex flex-col gap-2">
                    {(selectedInteraction.tweens || []).map((tween, index, tweens) => (
                      <SortableAnimationItem
                        key={tween.id}
                        tween={tween}
                        index={index}
                        tweens={tweens}
                        isSelected={selectedTweenId === tween.id}
                        targetLayer={findLayerById(allLayers, tween.layer_id)}
                        onSelect={() => setSelectedTweenId(tween.id)}
                        onRemove={() => handleRemoveTween(tween.id)}
                        onSelectLayer={onSelectLayer}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
      )}

      {/* Tween Settings - Only show when tween is selected */}
      {selectedInteraction && selectedTween && (
        <div className="border-t">
          <header className="py-5 flex justify-between">
            <span className="font-medium">Animation settings</span>
            {(() => {
              const hasProperties = getTweenProperties(selectedTween).length > 0;
              return (
                <div className="-my-1 flex gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="secondary"
                        className="size-6 p-0"
                        disabled={!hasProperties}
                        onClick={() => {
                          const { from, to, displayStart, displayEnd } = buildGsapProps(selectedTween);
                          playTweenPreview(
                            selectedTween.layer_id,
                            from,
                            to,
                            selectedTween.duration,
                            selectedTween.ease,
                            displayStart,
                            displayEnd,
                            selectedTween.splitText
                          );
                        }}
                      >
                        <Icon name="play" className="size-2.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Play animation</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="xs"
                        variant="secondary"
                        className="size-6 p-0"
                        disabled={!hasProperties}
                        onClick={clearAllPreviewStyles}
                      >
                        <Icon name="stop" className="size-2.5" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Reset animation</TooltipContent>
                  </Tooltip>
                </div>
              );
            })()}
          </header>

          <div className="flex flex-col gap-2 pb-4">
            {(() => {
              const isAtMode = typeof selectedTween.position === 'number';
              const selectValue = isAtMode ? 'at' : String(selectedTween.position);

              return (
                <div className="grid grid-cols-3 items-center">
                  <Label variant="muted">Start</Label>

                  <div className="col-span-2 flex gap-1.5">
                    <Select
                      value={selectValue}
                      onValueChange={(value) => {
                        if (value === 'at') {
                          handleUpdateTween(selectedTween.id, { position: 0.0 });
                        } else {
                          handleUpdateTween(selectedTween.id, { position: value });
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        {START_POSITION_OPTIONS[selectValue]?.short}
                      </SelectTrigger>
                      <SelectContent>
                        {Object.entries(START_POSITION_OPTIONS).map(([value, labels]) => (
                          <SelectItem key={value} value={value}>
                            {labels.long}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    {isAtMode && (
                      <Input
                        stepper
                        step="0.1"
                        min="0"
                        className="w-full"
                        value={positionInput}
                        onChange={(e) => {
                          const str = e.target.value;
                          setPositionInput(str);
                          if (str !== '' && !str.endsWith('.')) {
                            const num = parseFloat(str);
                            if (!isNaN(num) && num >= 0) {
                              handleUpdateTween(selectedTween.id, { position: num });
                            }
                          }
                        }}
                        onBlur={() => {
                          const num = parseFloat(positionInput);
                          if (!isNaN(num) && num >= 0) {
                            handleUpdateTween(selectedTween.id, { position: num });
                            setPositionInput(String(num));
                          } else if (typeof selectedTween.position === 'number') {
                            setPositionInput(String(selectedTween.position));
                          }
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })()}

            <div className="grid grid-cols-3">
              <Label variant="muted">Duration</Label>
              <div className="col-span-2 *:w-full">
                <InputGroup>
                  <InputGroupInput
                    stepper
                    step="0.1"
                    min="0"
                    value={durationInput}
                    onChange={(e) => {
                      const str = e.target.value;
                      setDurationInput(str);
                      if (str !== '' && !str.endsWith('.')) {
                        const num = parseFloat(str);
                        if (!isNaN(num) && num >= 0) {
                          handleUpdateTween(selectedTween.id, { duration: num });
                        }
                      }
                    }}
                    onBlur={() => {
                      const num = parseFloat(durationInput);
                      if (!isNaN(num) && num >= 0) {
                        handleUpdateTween(selectedTween.id, { duration: num });
                        setDurationInput(String(num));
                      } else {
                        setDurationInput(String(selectedTween.duration));
                      }
                    }}
                    placeholder="0"
                  />
                  <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                    sec
                  </InputGroupAddon>
                </InputGroup>
              </div>
            </div>

            <div className="grid grid-cols-3">
              <Label variant="muted">Ease</Label>
              <div className="col-span-2">
                <Select
                  value={selectedTween.ease}
                  onValueChange={(value) =>
                    handleUpdateTween(selectedTween.id, {
                      ease: value,
                    })
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EASE_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <Icon name={opt.icon} />
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Split Text Configuration */}
            <div className="grid grid-cols-3 items-center">
              <Label variant="muted">Animate</Label>
              <div className="col-span-2">
                <Select
                  value={selectedTween.splitText ? 'text' : 'layer'}
                  onValueChange={(value) => {
                    if (value === 'text') {
                      // Enable split text with default stagger of 0.5 seconds
                      handleUpdateTween(selectedTween.id, {
                        splitText: {
                          type: 'words',
                          stagger: { amount: 0.5 },
                        },
                      });
                    } else {
                      // Disable split text (animate layers normally)
                      handleUpdateTween(selectedTween.id, {
                        splitText: undefined,
                      });
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="layer">Layer element</SelectItem>
                    <SelectItem value="text">Text elements</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {selectedTween.splitText && (
              <>
                <div className="grid grid-cols-3 items-center">
                  <Label variant="muted">Split by</Label>
                  <div className="col-span-2">
                    <Select
                      value={selectedTween.splitText.type}
                      onValueChange={(value: 'chars' | 'words' | 'lines') =>
                        handleUpdateTween(selectedTween.id, {
                          splitText: {
                            ...selectedTween.splitText!,
                            type: value,
                          },
                        })
                      }
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="chars">Characters</SelectItem>
                        <SelectItem value="words">Words</SelectItem>
                        <SelectItem value="lines">Lines</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-3 items-center">
                  <div className="flex items-center gap-1.5">
                    <Label variant="muted">Stagger</Label>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Icon name="info" className="size-3 opacity-70" />
                      </TooltipTrigger>
                      <TooltipContent align="start">Total time between all elements</TooltipContent>
                    </Tooltip>
                  </div>

                  <div className="col-span-2">
                    <InputGroup>
                      <InputGroupInput
                        stepper
                        step="0.1"
                        min="0"
                        value={staggerInput}
                        onChange={(e) => {
                          const str = e.target.value;
                          setStaggerInput(str);
                          if (str !== '' && !str.endsWith('.')) {
                            const num = parseFloat(str);
                            if (!isNaN(num) && num >= 0) {
                              handleUpdateTween(selectedTween.id, {
                                splitText: {
                                  ...selectedTween.splitText!,
                                  stagger: { amount: num },
                                },
                              });
                            }
                          }
                        }}
                        onBlur={() => {
                          const num = parseFloat(staggerInput);
                          if (!isNaN(num) && num >= 0) {
                            handleUpdateTween(selectedTween.id, {
                              splitText: {
                                ...selectedTween.splitText!,
                                stagger: { amount: num },
                              },
                            });
                            setStaggerInput(String(num));
                          } else {
                            setStaggerInput(String(selectedTween.splitText?.stagger?.amount ?? 0));
                          }
                        }}
                      />
                      <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                        sec
                      </InputGroupAddon>
                    </InputGroup>
                  </div>
                </div>

              </>
            )}
          </div>
        </div>
      )}

      {/* Properties Section - Only show when tween is selected */}
      {selectedInteraction && selectedTween && (
        <div className="border-t pb-6">
          <header className="py-5 flex justify-between">
            <span className="font-medium">Animated properties</span>
            <div className="-my-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="xs" variant="secondary">
                    <Icon name="plus" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="mr-4">
                  {PROPERTY_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.type}
                      onClick={() => handleAddPropertyToTween(selectedTween.id, opt.type)}
                      disabled={isPropertyInTween(selectedTween, opt.type)}
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          {(() => {
            const tweenProperties = getTweenProperties(selectedTween);
            return tweenProperties.length === 0 ? (
              <Empty>
                <EmptyDescription>
                  Add a property to animate.
                </EmptyDescription>
              </Empty>
            ) : (
              <div className="flex flex-col gap-2.5">
                {tweenProperties.map((propertyOption) => (
                  <div key={propertyOption.type} className="flex flex-col gap-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {propertyOption.label}
                      </span>
                      <Button
                        size="xs"
                        variant="ghost"
                        className="size-5 p-0"
                        onClick={() => handleRemovePropertyFromTween(selectedTween.id, propertyOption.type)}
                      >
                        <Icon name="x" className="size-2.5" />
                      </Button>
                    </div>

                    {propertyOption.properties.map((prop) => {
                      const fromValue = selectedTween.from[prop.key];
                      const toValue = selectedTween.to[prop.key];
                      const isFromCurrent = fromValue === null || fromValue === undefined;
                      const isToCurrent = toValue === null || toValue === undefined;

                      const setFromValue = (value: string | null) => {
                        handleUpdateTween(selectedTween.id, {
                          from: { ...selectedTween.from, [prop.key]: value },
                        });
                      };

                      const getDefaultFromAfterCurrent = () => prop.defaultFromAfterCurrent;
                      const getDefaultToAfterCurrent = () => prop.defaultTo ?? '0';

                      // Determine animation mode based on from/to values
                      type AnimationMode = 'current-to-custom' | 'custom-to-current' | 'custom-to-custom';
                      const animationMode: AnimationMode = isFromCurrent
                        ? 'current-to-custom'
                        : isToCurrent
                          ? 'custom-to-current'
                          : 'custom-to-custom';

                      const handleModeChange = (mode: AnimationMode) => {
                        // Update both from and to in a single call to avoid state race conditions
                        const newFrom = mode === 'current-to-custom'
                          ? null
                          : (isFromCurrent ? getDefaultFromAfterCurrent() : fromValue);
                        const newTo = mode === 'custom-to-current'
                          ? null
                          : (isToCurrent ? getDefaultToAfterCurrent() : toValue);

                        // When from is current/null, apply_styles must be on-trigger
                        const newApplyStyles = mode === 'current-to-custom'
                          ? 'on-trigger'
                          : selectedTween.apply_styles?.[prop.key] || 'on-trigger';

                        handleUpdateTween(selectedTween.id, {
                          from: { ...selectedTween.from, [prop.key]: newFrom },
                          to: { ...selectedTween.to, [prop.key]: newTo },
                          apply_styles: { ...selectedTween.apply_styles, [prop.key]: newApplyStyles },
                        });
                      };

                      const applyFromPreview = (value: string | null) => {
                        // Skip display
                        if (prop.key === 'display') return;

                        if (value === null || value === undefined) return;
                        const gsapValue = toGsapValue(value, prop);
                        if (gsapValue !== undefined) {
                          applyPreviewStyles(
                            selectedTween.layer_id,
                            { [prop.key]: gsapValue },
                            { splitText: selectedTween.splitText, duration: selectedTween.duration }
                          );
                        }
                      };

                      const applyToPreview = (value: string | null) => {
                        // Skip display
                        if (prop.key === 'display') return;

                        if (value === null || value === undefined) return;
                        const gsapValue = toGsapValue(value, prop);
                        if (gsapValue !== undefined) {
                          applyPreviewStyles(
                            selectedTween.layer_id,
                            { [prop.key]: gsapValue },
                            { splitText: selectedTween.splitText, duration: selectedTween.duration }
                          );
                        }
                      };

                      const handlePreviewFrom = () => {
                        if (isFromCurrent) return;
                        // Clear any existing preview (e.g., from played animation) before applying
                        clearAllPreviewStyles();
                        applyFromPreview(fromValue as string);
                      };

                      const handlePreviewTo = () => {
                        // Clear any existing preview (e.g., from played animation) before applying
                        clearAllPreviewStyles();
                        const toValue = selectedTween.to[prop.key];
                        applyToPreview(toValue as string);
                      };

                      /** Helper to update property and apply preview after iframe re-renders */
                      const handlePropertyChange = (updateFn: () => void, applyPreviewFn: () => void) => {
                        isChangingPropertyRef.current = true;
                        updateFn();
                        // Apply preview after iframe re-renders (double RAF to ensure DOM is updated)
                        requestAnimationFrame(() => {
                          requestAnimationFrame(() => {
                            // Update originalStyle after iframe re-renders (element may have been recreated)
                            const element = getIframeElement(selectedTween.layer_id);
                            if (element && previewedElementRef.current?.layerId === selectedTween.layer_id) {
                              // If element was recreated, clear any cached SplitText instance
                              if (element !== previewedElementRef.current.element) {
                                const oldSplitInstance = splitTextInstancesRef.current.get(selectedTween.layer_id);
                                if (oldSplitInstance) {
                                  try {
                                    oldSplitInstance.revert();
                                  } catch (e) {
                                    // Ignore errors from reverting stale instances
                                  }
                                  splitTextInstancesRef.current.delete(selectedTween.layer_id);
                                }
                              }
                              previewedElementRef.current = {
                                ...previewedElementRef.current,
                                element,
                                originalStyle: element.getAttribute('style') || '',
                              };
                            }
                            applyPreviewFn();
                            isChangingPropertyRef.current = false;
                          });
                        });
                      };

                      const handleFromChange = (value: string) => {
                        handlePropertyChange(
                          () => setFromValue(value),
                          () => applyFromPreview(value)
                        );
                      };

                      const handleToChange = (value: string) => {
                        handlePropertyChange(
                          () => handleUpdateTween(selectedTween.id, {
                            to: { ...selectedTween.to, [prop.key]: value },
                          }),
                          () => applyToPreview(value)
                        );
                      };

                      return (
                        <div key={prop.key} className="flex items-center gap-1.25">
                          {!prop.toOnly && (
                            <>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    className="size-7 p-0 shrink-0 transition-none"
                                    disabled={isFromCurrent}
                                    onClick={() => {
                                      const currentValue = selectedTween.apply_styles?.[prop.key] || 'on-trigger';
                                      handleUpdateTween(selectedTween.id, {
                                        apply_styles: {
                                          ...selectedTween.apply_styles,
                                          [prop.key]: currentValue === 'on-load' ? 'on-trigger' : 'on-load',
                                        },
                                      });
                                    }}
                                  >
                                    <Icon name={selectedTween.apply_styles?.[prop.key] === 'on-load' ? 'page' : 'cursor-default'} />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent side="top" align="start">
                                  {selectedTween.apply_styles?.[prop.key] === 'on-load'
                                    ? 'Apply property style on page load'
                                    : 'Apply property style on trigger'}
                                </TooltipContent>
                              </Tooltip>

                              <div className="w-full flex items-center gap-1.5">
                                {isFromCurrent ? (
                                  <Button
                                    size="xs"
                                    variant="secondary"
                                    className="h-7 transition-none flex-1"
                                    disabled
                                  >
                                    Current
                                  </Button>
                                ) : prop.options ? (
                                  <Select
                                    value={fromValue as string}
                                    onValueChange={handleFromChange}
                                    onOpenChange={(open) => open ? handlePreviewFrom() : clearPreviewStyles()}
                                  >
                                    <SelectTrigger className="flex-1 h-7 text-xs">
                                      <SelectValue placeholder="From" />
                                    </SelectTrigger>
                                    <SelectContent>
                                      {prop.options.map((opt) => (
                                        <SelectItem key={opt.value} value={opt.value}>
                                          {opt.label}
                                        </SelectItem>
                                      ))}
                                    </SelectContent>
                                  </Select>
                                ) : prop.unit ? (
                                  <InputGroup className="flex-1 h-7">
                                    <InputGroupInput
                                      value={fromValue ?? ''}
                                      onChange={(e) => handleFromChange(e.target.value)}
                                      onFocus={handlePreviewFrom}
                                      onBlur={() => {
                                        // Defer clearing to ensure any pending RAF callbacks complete first
                                        // Store RAF IDs so they can be canceled if a new preview is applied
                                        const rafId1 = requestAnimationFrame(() => {
                                          const rafId2 = requestAnimationFrame(() => {
                                            clearPreviewStyles();
                                            // Remove this RAF ID from the pending list
                                            pendingClearRAFsRef.current = pendingClearRAFsRef.current.filter(id => id !== rafId1 && id !== rafId2);
                                          });
                                          pendingClearRAFsRef.current.push(rafId2);
                                        });
                                        pendingClearRAFsRef.current.push(rafId1);
                                      }}
                                      placeholder="0"
                                      className="text-xs"
                                    />
                                    <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                                      {prop.unit}
                                    </InputGroupAddon>
                                  </InputGroup>
                                ) : (
                                  <Input
                                    value={fromValue ?? ''}
                                    onChange={(e) => handleFromChange(e.target.value)}
                                    onFocus={handlePreviewFrom}
                                    onBlur={() => {
                                      // Defer clearing to ensure any pending RAF callbacks complete first
                                      // Store RAF IDs so they can be canceled if a new preview is applied
                                      const rafId1 = requestAnimationFrame(() => {
                                        const rafId2 = requestAnimationFrame(() => {
                                          clearPreviewStyles();
                                          // Remove this RAF ID from the pending list
                                          pendingClearRAFsRef.current = pendingClearRAFsRef.current.filter(id => id !== rafId1 && id !== rafId2);
                                        });
                                        pendingClearRAFsRef.current.push(rafId2);
                                      });
                                      pendingClearRAFsRef.current.push(rafId1);
                                    }}
                                    placeholder="0"
                                    className="flex-1 h-7 text-xs"
                                  />
                                )}
                              </div>

                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="xs"
                                    variant="ghost"
                                    className="size-7 p-0 shrink-0"
                                  >
                                    <Icon name="chevronRight" className="size-2.5 opacity-60" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="center" side="bottom">
                                  <DropdownMenuCheckboxItem
                                    checked={animationMode === 'current-to-custom'}
                                    onCheckedChange={() => handleModeChange('current-to-custom')}
                                  >
                                    Current value <Icon name="chevronRight" className="size-2.5 opacity-60" /> Set value
                                  </DropdownMenuCheckboxItem>
                                  <DropdownMenuCheckboxItem
                                    checked={animationMode === 'custom-to-current'}
                                    onCheckedChange={() => handleModeChange('custom-to-current')}
                                  >
                                    Set value <Icon name="chevronRight" className="size-2.5 opacity-60" /> Current value
                                  </DropdownMenuCheckboxItem>
                                  <DropdownMenuCheckboxItem
                                    checked={animationMode === 'custom-to-custom'}
                                    onCheckedChange={() => handleModeChange('custom-to-custom')}
                                  >
                                    Set value <Icon name="chevronRight" className="size-2.5 opacity-60" /> Set value
                                  </DropdownMenuCheckboxItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            </>
                          )}

                          <div className="w-full flex items-center gap-1.5">
                            {isToCurrent ? (
                              <Button
                                size="xs"
                                variant="secondary"
                                className="h-7 transition-none flex-1"
                                disabled
                              >
                                Current
                              </Button>
                            ) : prop.options ? (
                              <Select
                                value={toValue as string}
                                onValueChange={handleToChange}
                                onOpenChange={(open) => open ? handlePreviewTo() : clearPreviewStyles()}
                              >
                                <SelectTrigger className="flex-1 h-7 text-xs">
                                  <SelectValue placeholder="To" />
                                </SelectTrigger>
                                <SelectContent>
                                  {prop.options.map((opt) => (
                                    <SelectItem key={opt.value} value={opt.value}>
                                      {opt.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : prop.unit ? (
                              <InputGroup className="flex-1 h-7">
                                <InputGroupInput
                                  value={toValue ?? ''}
                                  onChange={(e) => handleToChange(e.target.value)}
                                  onFocus={handlePreviewTo}
                                  onBlur={() => {
                                    // Defer clearing to ensure any pending RAF callbacks complete first
                                    // Store RAF IDs so they can be canceled if a new preview is applied
                                    const rafId1 = requestAnimationFrame(() => {
                                      const rafId2 = requestAnimationFrame(() => {
                                        clearPreviewStyles();
                                        // Remove this RAF ID from the pending list
                                        pendingClearRAFsRef.current = pendingClearRAFsRef.current.filter(id => id !== rafId1 && id !== rafId2);
                                      });
                                      pendingClearRAFsRef.current.push(rafId2);
                                    });
                                    pendingClearRAFsRef.current.push(rafId1);
                                  }}
                                  placeholder="0"
                                  className="text-xs"
                                />
                                <InputGroupAddon align="inline-end" className="text-xs text-muted-foreground">
                                  {prop.unit}
                                </InputGroupAddon>
                              </InputGroup>
                            ) : (
                              <Input
                                value={toValue ?? ''}
                                onChange={(e) => handleToChange(e.target.value)}
                                onFocus={handlePreviewTo}
                                onBlur={() => {
                                  // Defer clearing to ensure any pending RAF callbacks complete first
                                  // Store RAF IDs so they can be canceled if a new preview is applied
                                  const rafId1 = requestAnimationFrame(() => {
                                    const rafId2 = requestAnimationFrame(() => {
                                      clearPreviewStyles();
                                      // Remove this RAF ID from the pending list
                                      pendingClearRAFsRef.current = pendingClearRAFsRef.current.filter(id => id !== rafId1 && id !== rafId2);
                                    });
                                    pendingClearRAFsRef.current.push(rafId2);
                                  });
                                  pendingClearRAFsRef.current.push(rafId1);
                                }}
                                placeholder="0"
                                className="flex-1 h-7 text-xs"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
