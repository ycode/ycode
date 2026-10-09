'use client';

import React, { useCallback, useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import CssVariableInput from './css-variables/CssVariableInput';
import { cn } from '@/lib/utils';

interface SpacingValues {
  marginTop: string;
  marginRight: string;
  marginBottom: string;
  marginLeft: string;
  paddingTop: string;
  paddingRight: string;
  paddingBottom: string;
  paddingLeft: string;
}

interface MarginPaddingProps {
  values: SpacingValues;
  onChange: (property: keyof SpacingValues, value: string) => void;
}

type Side = 'top' | 'right' | 'bottom' | 'left';
type BoxType = 'margin' | 'padding';

interface DragEvent {
  delta: number;
  altKey: boolean;
  shiftKey: boolean;
}

const SIDE_CURSOR: Record<Side, string> = {
  top: 'ns-resize',
  right: 'ew-resize',
  bottom: 'ns-resize',
  left: 'ew-resize',
};

const OPPOSITE: Record<Side, Side> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

type EdgeState = 'idle' | 'hover' | 'active';

function BoxEdge({
  side,
  isDashed,
  onDrag,
  edgeState,
  isDragActive,
  onHoverEnter,
  onHoverLeave,
  onDragStart,
  onDragEnd,
}: {
  side: Side;
  isDashed?: boolean;
  onDrag?: (e: DragEvent) => void;
  edgeState: EdgeState;
  isDragActive: boolean;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const borderStyle = isDashed ? 'border-dashed' : '';
  const isVertical = side === 'left' || side === 'right';
  const [isDragging, setIsDragging] = useState(false);
  const lastPosRef = useRef(0);
  const isDraggingRef = useRef(false);
  const onDragRef = useRef(onDrag);
  onDragRef.current = onDrag;
  const onDragEndRef = useRef(onDragEnd);
  onDragEndRef.current = onDragEnd;

  const positionClasses: Record<Side, string> = {
    top: 'block w-full top-0',
    right: 'flex h-full right-0 top-0',
    bottom: 'block w-full bottom-0',
    left: 'flex h-full left-0 top-0',
  };

  const borderClasses: Record<Side, string> = {
    top: `border-t border-l border-r rounded-t-xl w-full h-1.5 ${borderStyle}`,
    right: `border-t border-b border-r rounded-tr-xl rounded-br-xl h-full w-1.5 ${borderStyle}`,
    bottom: `border-b border-l border-r rounded-b-xl w-full h-1.5 ${borderStyle}`,
    left: `border-t border-b border-l rounded-tl-xl rounded-bl-xl h-full w-1.5 ${borderStyle}`,
  };

  const handleClasses: Record<Side, string> = {
    top: 'bottom-0 left-0 right-0',
    right: 'h-full left-0',
    bottom: 'top-0 left-0 right-0',
    left: 'h-full right-0',
  };

  const isActiveDuringDrag = edgeState === 'active' && isDragActive;

  const colorClass =
    isDragging || isActiveDuringDrag
      ? 'text-blue-500'
      : edgeState === 'hover' || edgeState === 'active'
        ? 'text-neutral-400'
        : 'text-neutral-600';

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isDraggingRef.current) return;

      const isHorizontal = side === 'left' || side === 'right';
      const currentPos = isHorizontal ? e.clientX : e.clientY;
      const rawDelta = currentPos - lastPosRef.current;

      const sign = (side === 'top' || side === 'left') ? -1 : 1;
      const delta = rawDelta * sign;

      if (Math.abs(rawDelta) >= 1) {
        lastPosRef.current = currentPos;
        onDragRef.current?.({ delta, altKey: e.altKey, shiftKey: e.shiftKey });
      }
    };

    const onUp = () => {
      if (!isDraggingRef.current) return;
      isDraggingRef.current = false;
      setIsDragging(false);
      onDragEndRef.current();
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [side]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    setIsDragging(true);
    onDragStart();

    const isHorizontal = side === 'left' || side === 'right';
    lastPosRef.current = isHorizontal ? e.clientX : e.clientY;
  }, [side, onDragStart]);

  return (
    <>
      <div
        tabIndex={-1}
        className={cn(
          'absolute z-10 hover:z-20 active:z-20',
          colorClass,
          positionClasses[side],
        )}
        style={{ cursor: SIDE_CURSOR[side] }}
        onMouseDown={handleMouseDown}
        onMouseEnter={onHoverEnter}
        onMouseLeave={onHoverLeave}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className={cn('border-current', borderClasses[side])} />
        <div
          className={cn(
            'p-0.5 absolute z-10 flex items-center',
            isVertical ? 'h-full' : '',
            handleClasses[side],
          )}
        >
          <div className="h-2 w-2 border border-current mx-auto bg-background" />
        </div>
      </div>

      {isDragging && createPortal(
        <div
          className="fixed inset-0 z-50"
          style={{ cursor: SIDE_CURSOR[side] }}
        />,
        document.body,
      )}
    </>
  );
}

function SpacingInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <CssVariableInput
      ref={inputRef}
      value={value}
      onChange={handleChange}
      placeholder="0"
      className="text-center bg-transparent border-transparent px-0"
    />
  );
}

type SpacingProperty = keyof SpacingValues;

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];

const MARGIN_MAP: Record<Side, SpacingProperty> = {
  top: 'marginTop',
  right: 'marginRight',
  bottom: 'marginBottom',
  left: 'marginLeft',
};

const PADDING_MAP: Record<Side, SpacingProperty> = {
  top: 'paddingTop',
  right: 'paddingRight',
  bottom: 'paddingBottom',
  left: 'paddingLeft',
};

function applyDelta(current: string, delta: number): string {
  const numValue = parseFloat(current) || 0;
  return String(numValue + delta);
}

type EdgeKey = `${BoxType}-${Side}`;

function edgeKey(box: BoxType, side: Side): EdgeKey {
  return `${box}-${side}`;
}

function useModifierKeys() {
  const [modifiers, setModifiers] = useState({ altKey: false, shiftKey: false });

  useEffect(() => {
    const update = (e: KeyboardEvent) => {
      setModifiers({ altKey: e.altKey, shiftKey: e.shiftKey });
    };
    const reset = () => {
      setModifiers({ altKey: false, shiftKey: false });
    };

    document.addEventListener('keydown', update);
    document.addEventListener('keyup', update);
    window.addEventListener('blur', reset);
    return () => {
      document.removeEventListener('keydown', update);
      document.removeEventListener('keyup', update);
      window.removeEventListener('blur', reset);
    };
  }, []);

  return modifiers;
}

export default function MarginPadding({ values, onChange }: MarginPaddingProps) {
  const valuesRef = useRef(values);
  valuesRef.current = values;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const accumulators = useRef<Record<string, number>>({});

  const [hoveredEdge, setHoveredEdge] = useState<{ box: BoxType; side: Side } | null>(null);
  const [draggingEdge, setDraggingEdge] = useState<{ box: BoxType; side: Side } | null>(null);
  const [dragModifiers, setDragModifiers] = useState({ altKey: false, shiftKey: false });
  const { altKey, shiftKey } = useModifierKeys();

  const activeEdge = draggingEdge || hoveredEdge;
  const activeAlt = draggingEdge ? dragModifiers.altKey : altKey;
  const activeShift = draggingEdge ? dragModifiers.shiftKey : shiftKey;

  const highlightedEdges = new Set<EdgeKey>();
  if (activeEdge) {
    const { box, side } = activeEdge;
    highlightedEdges.add(edgeKey(box, side));
    if (activeShift) {
      for (const s of SIDES) highlightedEdges.add(edgeKey(box, s));
    } else if (activeAlt) {
      highlightedEdges.add(edgeKey(box, OPPOSITE[side]));
    }
  }

  const getEdgeState = (box: BoxType, side: Side): EdgeState => {
    if (!activeEdge) return 'idle';
    if (activeEdge.box === box && activeEdge.side === side) return 'hover';
    if (highlightedEdges.has(edgeKey(box, side))) return 'active';
    return 'idle';
  };

  const makeDragHandler = useCallback((side: Side, propMap: Record<Side, SpacingProperty>) => {
    return (e: DragEvent) => {
      setDragModifiers({ altKey: e.altKey, shiftKey: e.shiftKey });

      const primary = propMap[side];

      const siblings: SpacingProperty[] = [];
      if (e.shiftKey) {
        for (const s of SIDES) {
          const p = propMap[s];
          if (p !== primary) siblings.push(p);
        }
      } else if (e.altKey) {
        siblings.push(propMap[OPPOSITE[side]]);
      }

      const key = primary;
      if (!accumulators.current[key]) accumulators.current[key] = 0;
      accumulators.current[key] += e.delta;

      const stepped = Math.trunc(accumulators.current[key]);
      if (stepped !== 0) {
        accumulators.current[key] -= stepped;
        const newValue = applyDelta(valuesRef.current[primary], stepped);
        onChangeRef.current(primary, newValue);

        for (const prop of siblings) {
          onChangeRef.current(prop, newValue);
        }
      }
    };
  }, []);

  const dragMT = useCallback((e: DragEvent) => makeDragHandler('top', MARGIN_MAP)(e), [makeDragHandler]);
  const dragMR = useCallback((e: DragEvent) => makeDragHandler('right', MARGIN_MAP)(e), [makeDragHandler]);
  const dragMB = useCallback((e: DragEvent) => makeDragHandler('bottom', MARGIN_MAP)(e), [makeDragHandler]);
  const dragML = useCallback((e: DragEvent) => makeDragHandler('left', MARGIN_MAP)(e), [makeDragHandler]);
  const dragPT = useCallback((e: DragEvent) => makeDragHandler('top', PADDING_MAP)(e), [makeDragHandler]);
  const dragPR = useCallback((e: DragEvent) => makeDragHandler('right', PADDING_MAP)(e), [makeDragHandler]);
  const dragPB = useCallback((e: DragEvent) => makeDragHandler('bottom', PADDING_MAP)(e), [makeDragHandler]);
  const dragPL = useCallback((e: DragEvent) => makeDragHandler('left', PADDING_MAP)(e), [makeDragHandler]);

  const handleMT = useCallback((v: string) => onChange('marginTop', v), [onChange]);
  const handleMR = useCallback((v: string) => onChange('marginRight', v), [onChange]);
  const handleMB = useCallback((v: string) => onChange('marginBottom', v), [onChange]);
  const handleML = useCallback((v: string) => onChange('marginLeft', v), [onChange]);
  const handlePT = useCallback((v: string) => onChange('paddingTop', v), [onChange]);
  const handlePR = useCallback((v: string) => onChange('paddingRight', v), [onChange]);
  const handlePB = useCallback((v: string) => onChange('paddingBottom', v), [onChange]);
  const handlePL = useCallback((v: string) => onChange('paddingLeft', v), [onChange]);

  const hoverIn = useCallback((box: BoxType, side: Side) => () => setHoveredEdge({ box, side }), []);
  const hoverOut = useCallback(() => setHoveredEdge(null), []);
  const dragStart = useCallback((box: BoxType, side: Side) => () => setDraggingEdge({ box, side }), []);
  const dragEnd = useCallback(() => { setDraggingEdge(null); setDragModifiers({ altKey: false, shiftKey: false }); }, []);
  const isDragActive = !!draggingEdge;

  return (
    <div className="flex flex-col items-center gap-3">
    <div className="grid grid-cols-[44px_44px_1fr_44px_44px] grid-rows-[auto_auto_auto_auto_auto] max-w-[214px] mx-auto">
      {/* Margin box (outer, dashed) */}
      <div className="relative col-span-5 row-span-5 col-start-1 row-start-1">
        <BoxEdge
          side="top" isDashed
          onDrag={dragMT} edgeState={getEdgeState('margin', 'top')}
          isDragActive={isDragActive} onHoverEnter={hoverIn('margin', 'top')}
          onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'top')}
          onDragEnd={dragEnd}
        />
        <BoxEdge
          side="right" isDashed
          onDrag={dragMR} edgeState={getEdgeState('margin', 'right')}
          isDragActive={isDragActive} onHoverEnter={hoverIn('margin', 'right')}
          onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'right')}
          onDragEnd={dragEnd}
        />
        <BoxEdge
          side="bottom" isDashed
          onDrag={dragMB} edgeState={getEdgeState('margin', 'bottom')}
          isDragActive={isDragActive} onHoverEnter={hoverIn('margin', 'bottom')}
          onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'bottom')}
          onDragEnd={dragEnd}
        />
        <BoxEdge
          side="left" isDashed
          onDrag={dragML} edgeState={getEdgeState('margin', 'left')}
          isDragActive={isDragActive} onHoverEnter={hoverIn('margin', 'left')}
          onHoverLeave={hoverOut} onDragStart={dragStart('margin', 'left')}
          onDragEnd={dragEnd}
        />
        <span className="absolute bottom-0 right-0 m-2 text-[9px] text-muted-foreground/60 leading-3 select-none">
          Margin
        </span>
      </div>

      {/* Padding box (inner, solid) */}
      <div className="relative col-start-2 row-start-2 col-span-3 row-span-3">
        <BoxEdge
          side="top" onDrag={dragPT}
          edgeState={getEdgeState('padding', 'top')} isDragActive={isDragActive}
          onHoverEnter={hoverIn('padding', 'top')} onHoverLeave={hoverOut}
          onDragStart={dragStart('padding', 'top')} onDragEnd={dragEnd}
        />
        <BoxEdge
          side="right" onDrag={dragPR}
          edgeState={getEdgeState('padding', 'right')} isDragActive={isDragActive}
          onHoverEnter={hoverIn('padding', 'right')} onHoverLeave={hoverOut}
          onDragStart={dragStart('padding', 'right')} onDragEnd={dragEnd}
        />
        <BoxEdge
          side="bottom" onDrag={dragPB}
          edgeState={getEdgeState('padding', 'bottom')} isDragActive={isDragActive}
          onHoverEnter={hoverIn('padding', 'bottom')} onHoverLeave={hoverOut}
          onDragStart={dragStart('padding', 'bottom')} onDragEnd={dragEnd}
        />
        <BoxEdge
          side="left" onDrag={dragPL}
          edgeState={getEdgeState('padding', 'left')} isDragActive={isDragActive}
          onHoverEnter={hoverIn('padding', 'left')} onHoverLeave={hoverOut}
          onDragStart={dragStart('padding', 'left')} onDragEnd={dragEnd}
        />
        <span className="absolute bottom-0 right-0 m-2 text-[9px] text-muted-foreground/60 leading-3 select-none">
          Padding
        </span>
      </div>

      {/* Margin inputs */}
      <div className="col-start-3 row-start-1 justify-self-center self-center my-1.5 z-20">
        <SpacingInput value={values.marginTop} onChange={handleMT} />
      </div>
      <div className="col-start-5 row-start-3 justify-self-center self-center mx-1 z-20">
        <SpacingInput value={values.marginRight} onChange={handleMR} />
      </div>
      <div className="col-start-3 row-start-5 justify-self-center self-center my-1.5 z-20">
        <SpacingInput value={values.marginBottom} onChange={handleMB} />
      </div>
      <div className="col-start-1 row-start-3 justify-self-center self-center mx-1 z-20">
        <SpacingInput value={values.marginLeft} onChange={handleML} />
      </div>

      {/* Padding inputs */}
      <div className="col-start-3 row-start-2 justify-self-center self-center mt-1.5 z-20">
        <SpacingInput value={values.paddingTop} onChange={handlePT} />
      </div>
      <div className="col-start-4 row-start-3 justify-self-center self-center mr-1.5 z-20">
        <SpacingInput value={values.paddingRight} onChange={handlePR} />
      </div>
      <div className="col-start-3 row-start-4 justify-self-center self-center mb-1.5 z-20">
        <SpacingInput value={values.paddingBottom} onChange={handlePB} />
      </div>
      <div className="col-start-2 row-start-3 justify-self-center self-center ml-1.5 z-20">
        <SpacingInput value={values.paddingLeft} onChange={handlePL} />
      </div>

      {/* Center content block */}
      <div className="col-start-3 row-start-3 h-full p-0.5">
        <div className="bg-input rounded-[8px] w-full h-full min-h-4 min-w-4" />
      </div>
    </div>

    </div>
  );
}
