'use client';

import React, { useEffect, useLayoutEffect, useRef, useCallback, useState } from 'react';
import { useFilterStore } from '@/stores/useFilterStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useEditorStore } from '@/stores/useEditorStore';
import type { ConditionalVisibility, Layer } from '@/types';
import { isDateFieldType, isDatePreset, resolveDateFilterValue } from '@/lib/collection-field-utils';

interface FilterableCollectionProps {
  children: React.ReactNode;
  collectionId: string;
  collectionLayerId: string;
  filters: ConditionalVisibility;
  userScope?: boolean;
  userScopeFieldId?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  sortByInputLayerId?: string;
  sortOrderInputLayerId?: string;
  limit?: number;
  paginationMode?: 'pages' | 'load_more';
  layerTemplate: Layer[];
  collectionLayerClasses?: string[];
  collectionLayerTag?: string;
  isPublished?: boolean;
}

const FC_FILTERED_ATTR = 'data-fc-filtered';

export default function FilterableCollection({
  children,
  collectionId,
  collectionLayerId,
  filters,
  userScope,
  userScopeFieldId,
  sortBy,
  sortOrder,
  sortByInputLayerId,
  sortOrderInputLayerId,
  limit,
  paginationMode,
  layerTemplate,
  collectionLayerClasses,
  collectionLayerTag,
  isPublished = true,
}: FilterableCollectionProps) {
  const isPreviewMode = useEditorStore((s) => s.isPreviewMode);
  const previewUserId = usePagesStore((s) => s.previewUserId);
  const markerRef = useRef<HTMLSpanElement>(null);
  const ssrChildrenRef = useRef<Element[]>([]);
  const [isFiltering, setIsFiltering] = useState(false);
  const [hasActiveFilters, setHasActiveFilters] = useState(false);
  const prevFilterKeyRef = useRef<string>('');
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRequestKeyRef = useRef<string | null>(null);

  const hasInputLinkedFilters = filters.groups.some(g =>
    g.conditions.some(c => c.inputLayerId || c.inputLayerId2)
  ) || userScope;
  const pendingFirstEvalRef = useRef(hasInputLinkedFilters);

  const [filteredPage, setFilteredPage] = useState(1);
  const [filteredTotalPages, setFilteredTotalPages] = useState(1);
  const [filteredHasMore, setFilteredHasMore] = useState(false);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [filteredLoaded, setFilteredLoaded] = useState(0);
  const loadMoreOffsetRef = useRef(0);

  const ssrPaginationTextRef = useRef<string | null>(null);
  const ssrPrevClassRef = useRef<string | null>(null);
  const ssrNextClassRef = useRef<string | null>(null);
  const ssrCountTextRef = useRef<string | null>(null);
  const ssrLoadMoreBtnDisplayRef = useRef<string | null>(null);
  const strippedPaginationParamRef = useRef(false);

  const strippedId = collectionLayerId.startsWith('lyr-')
    ? collectionLayerId.slice(4)
    : collectionLayerId;
  const pKey = `p_${strippedId}`;
  const fpKey = `fp_${strippedId}`;

  // --- DOM helpers: find parent collection layer, hide/show SSR children ---

  const getParent = useCallback(() => {
    return markerRef.current?.parentElement as HTMLElement | null;
  }, []);

  const hideSSR = useCallback(() => {
    ssrChildrenRef.current.forEach(el => {
      (el as HTMLElement).style.display = 'none';
    });
  }, []);

  const showSSR = useCallback(() => {
    ssrChildrenRef.current.forEach(el => {
      (el as HTMLElement).style.display = '';
    });
  }, []);

  const clearFilteredDOM = useCallback(() => {
    const parent = getParent();
    if (!parent) return;
    parent.querySelectorAll(`[${FC_FILTERED_ATTR}]`).forEach(el => el.remove());
  }, [getParent]);

  const injectFilteredHTML = useCallback((html: string, append: boolean) => {
    const parent = getParent();
    if (!parent) return;
    if (!append) {
      hideSSR();
      clearFilteredDOM();
    }
    const temp = document.createElement('div');
    temp.innerHTML = html;
    while (temp.firstChild) {
      const child = temp.firstChild;
      if (child instanceof Element) child.setAttribute(FC_FILTERED_ATTR, '');
      parent.appendChild(child);
    }
  }, [getParent, hideSSR, clearFilteredDOM]);

  // Capture SSR children on mount (before paint) and hide if pending
  useLayoutEffect(() => {
    if (!markerRef.current) return;
    const parent = markerRef.current.parentElement;
    if (!parent) return;
    ssrChildrenRef.current = Array.from(parent.children).filter(
      el => el !== markerRef.current
    );
    if (pendingFirstEvalRef.current) {
      hideSSR();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const filterValues = useFilterStore((state) => state.values);

  const findLinkedInputValue = useCallback((inputLayerId?: string): string => {
    if (!inputLayerId) return '';
    for (const layerValues of Object.values(filterValues)) {
      if (inputLayerId in layerValues) {
        return layerValues[inputLayerId] || '';
      }
    }
    return '';
  }, [filterValues]);

  const linkedSortByValue = findLinkedInputValue(sortByInputLayerId).trim();
  const linkedSortOrderValue = findLinkedInputValue(sortOrderInputLayerId).trim().toLowerCase();

  const isLinkedSortByValid = linkedSortByValue.length > 0 && linkedSortByValue !== 'none';
  const isLinkedSortOrderValid = linkedSortOrderValue === 'asc' || linkedSortOrderValue === 'desc';

  const effectiveSortBy = isLinkedSortByValid ? linkedSortByValue : sortBy;
  const effectiveSortOrder = (isLinkedSortOrderValid ? linkedSortOrderValue : sortOrder) as 'asc' | 'desc' | undefined;
  const hasRuntimeSortOverride = Boolean(
    (sortByInputLayerId && isLinkedSortByValid) ||
    (sortOrderInputLayerId && isLinkedSortOrderValid)
  );

  const buildApiFilters = useCallback(() => {
    type FilterItem = { fieldId: string; operator: string; value: string; value2?: string; fieldType?: string };
    const operatorsWithoutValue = new Set([
      'is_present',
      'is_empty',
      'is_not_empty',
      'has_items',
      'has_no_items',
      'exists',
      'does_not_exist',
    ]);

    const activeByGroup: FilterItem[][] = [];

    for (const group of filters.groups) {
      const activeInGroup: FilterItem[] = [];

      for (const condition of group.conditions) {
        if (!condition.fieldId) continue;

        let value = condition.inputLayerId ? '' : (condition.value || '');
        let value2 = condition.inputLayerId2 ? '' : condition.value2;

        if (condition.inputLayerId) {
          let inputValue = '';
          for (const layerValues of Object.values(filterValues)) {
            if (condition.inputLayerId in layerValues) {
              inputValue = layerValues[condition.inputLayerId];
              break;
            }
          }
          if (!inputValue && condition.operator !== 'is_between') continue;
          if (condition.fieldType === 'boolean' && inputValue === 'false') continue;

          if (inputValue && inputValue.includes(',')) {
            const checkedValues = inputValue.split(',').filter(Boolean);
            if (checkedValues.length > 0) {
              const arrayOperators = ['is_one_of', 'is_not_one_of', 'contains_all_of', 'contains_exactly'];
              activeInGroup.push({
                fieldId: condition.fieldId,
                operator: arrayOperators.includes(condition.operator) ? condition.operator : 'is_one_of',
                value: JSON.stringify(checkedValues),
                fieldType: condition.fieldType,
              });
            }
            continue;
          }

          if (inputValue) value = inputValue;
        }

        if (condition.inputLayerId2) {
          let inputValue2 = '';
          for (const layerValues of Object.values(filterValues)) {
            if (condition.inputLayerId2 in layerValues) {
              inputValue2 = layerValues[condition.inputLayerId2];
              break;
            }
          }
          if (!inputValue2 && condition.operator !== 'is_between') continue;
          if (inputValue2) value2 = inputValue2;
        }

        const requiresValue = !operatorsWithoutValue.has(condition.operator);
        if (condition.operator === 'is_between') {
          if (!value && !value2) continue;
        } else if (requiresValue && !value) {
          continue;
        }

        if (
          (condition.fieldType === 'reference' || condition.fieldType === 'multi_reference') &&
          ['is_one_of', 'is_not_one_of', 'contains_all_of', 'contains_exactly'].includes(condition.operator) &&
          condition.inputLayerId
        ) {
          value = JSON.stringify([value]);
        }

        let resolvedOperator: string = condition.operator;
        if (isDateFieldType(condition.fieldType) && isDatePreset(value)) {
          const resolved = resolveDateFilterValue(condition.operator, value, value2);
          if (!resolved) continue;
          resolvedOperator = resolved.operator;
          value = resolved.value;
          value2 = resolved.value2;
        }

        activeInGroup.push({
          fieldId: condition.fieldId,
          operator: resolvedOperator,
          value,
          value2,
          fieldType: condition.fieldType,
        });
      }

      if (activeInGroup.length > 0) {
        activeByGroup.push(activeInGroup);
      }
    }

    if (activeByGroup.length === 0) return [];

    const MAX_FILTER_GROUPS = 50;
    let result: FilterItem[][] = [[]];
    for (const groupConditions of activeByGroup) {
      const expanded: FilterItem[][] = [];
      for (const existing of result) {
        for (const cond of groupConditions) {
          expanded.push([...existing, cond]);
          if (expanded.length >= MAX_FILTER_GROUPS) break;
        }
        if (expanded.length >= MAX_FILTER_GROUPS) break;
      }
      result = expanded;
      if (result.length >= MAX_FILTER_GROUPS) break;
    }

    return result;
  }, [filters, filterValues]);

  const updateEmptyStateElements = useCallback((filteredCount: number) => {
    const emptyEls = document.querySelectorAll(
      `[data-collection-empty-state="${collectionLayerId}"]`
    );
    const hasItemsEls = document.querySelectorAll(
      `[data-collection-has-items="${collectionLayerId}"]`
    );
    const itemCountEls = document.querySelectorAll(
      `[data-collection-item-count="${collectionLayerId}"]`
    );

    const evaluateItemCount = (count: number, op: string, value: number): boolean => {
      if (op === 'lt') return count < value;
      if (op === 'lte') return count <= value;
      if (op === 'gt') return count > value;
      if (op === 'gte') return count >= value;
      return count === value;
    };

    if (filteredCount < 0) {
      emptyEls.forEach(el => { (el as HTMLElement).style.display = 'none'; });
      hasItemsEls.forEach(el => { (el as HTMLElement).style.display = 'none'; });
      itemCountEls.forEach(el => { (el as HTMLElement).style.display = 'none'; });
    } else {
      emptyEls.forEach(el => {
        (el as HTMLElement).style.display = filteredCount === 0 ? '' : 'none';
      });
      hasItemsEls.forEach(el => {
        (el as HTMLElement).style.display = filteredCount > 0 ? '' : 'none';
      });
      itemCountEls.forEach(el => {
        const node = el as HTMLElement;
        const op = node.getAttribute('data-collection-item-count-op') || 'eq';
        const rawValue = node.getAttribute('data-collection-item-count-value') || '0';
        const value = Number.parseInt(rawValue, 10);
        const shouldShow = evaluateItemCount(filteredCount, op, Number.isNaN(value) ? 0 : value);
        node.style.display = shouldShow ? '' : 'none';
      });
    }
  }, [collectionLayerId]);

  // --- SSR pagination DOM helpers ---

  const getSsrPaginationWrapper = useCallback(() => {
    return document.querySelector(
      `[data-pagination-for="${collectionLayerId}"]`
    ) as HTMLElement | null;
  }, [collectionLayerId]);

  const updateSsrPaginationDisplay = useCallback((page: number, totalPages: number) => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper) return;

    const infoEl = wrapper.querySelector(`[data-layer-id$="-pagination-info"]`) as HTMLElement | null;
    if (infoEl) {
      if (ssrPaginationTextRef.current === null) {
        ssrPaginationTextRef.current = infoEl.textContent || '';
      }
      infoEl.textContent = `Page ${page} of ${totalPages}`;
    }

    const prevBtn = wrapper.querySelector(`[data-pagination-action="prev"]`) as HTMLElement | null;
    if (prevBtn) {
      if (ssrPrevClassRef.current === null) {
        ssrPrevClassRef.current = prevBtn.className;
      }
      const isFirst = page <= 1;
      if (isFirst) {
        prevBtn.classList.add('opacity-50', 'cursor-not-allowed');
        prevBtn.classList.remove('cursor-pointer');
      } else {
        prevBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        prevBtn.classList.add('cursor-pointer');
      }
    }

    const nextBtn = wrapper.querySelector(`[data-pagination-action="next"]`) as HTMLElement | null;
    if (nextBtn) {
      if (ssrNextClassRef.current === null) {
        ssrNextClassRef.current = nextBtn.className;
      }
      const isLast = page >= totalPages;
      if (isLast) {
        nextBtn.classList.add('opacity-50', 'cursor-not-allowed');
        nextBtn.classList.remove('cursor-pointer');
      } else {
        nextBtn.classList.remove('opacity-50', 'cursor-not-allowed');
        nextBtn.classList.add('cursor-pointer');
      }
    }
  }, [getSsrPaginationWrapper]);

  const updateSsrLoadMoreDisplay = useCallback((loaded: number, total: number, hasMore: boolean) => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper) return;

    const countEl = wrapper.querySelector(`[data-layer-id$="-pagination-count"]`) as HTMLElement | null;
    if (countEl) {
      if (ssrCountTextRef.current === null) {
        ssrCountTextRef.current = countEl.textContent || '';
      }
      countEl.textContent = `Showing ${loaded} of ${total}`;
    }

    const loadMoreBtn = wrapper.querySelector(`[data-pagination-action="load_more"]`) as HTMLElement | null;
    if (loadMoreBtn) {
      if (ssrLoadMoreBtnDisplayRef.current === null) {
        ssrLoadMoreBtnDisplayRef.current = loadMoreBtn.style.display;
      }
      loadMoreBtn.style.display = hasMore ? '' : 'none';
    }
  }, [getSsrPaginationWrapper]);

  const restoreSsrPagination = useCallback(() => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper) return;

    if (ssrPaginationTextRef.current !== null) {
      const infoEl = wrapper.querySelector(`[data-layer-id$="-pagination-info"]`) as HTMLElement | null;
      if (infoEl) {
        infoEl.textContent = ssrPaginationTextRef.current;
      }
      ssrPaginationTextRef.current = null;
    }

    if (ssrPrevClassRef.current !== null) {
      const prevBtn = wrapper.querySelector(`[data-pagination-action="prev"]`) as HTMLElement | null;
      if (prevBtn) prevBtn.className = ssrPrevClassRef.current;
      ssrPrevClassRef.current = null;
    }

    if (ssrNextClassRef.current !== null) {
      const nextBtn = wrapper.querySelector(`[data-pagination-action="next"]`) as HTMLElement | null;
      if (nextBtn) nextBtn.className = ssrNextClassRef.current;
      ssrNextClassRef.current = null;
    }

    if (ssrCountTextRef.current !== null) {
      const countEl = wrapper.querySelector(`[data-layer-id$="-pagination-count"]`) as HTMLElement | null;
      if (countEl) countEl.textContent = ssrCountTextRef.current;
      ssrCountTextRef.current = null;
    }

    if (ssrLoadMoreBtnDisplayRef.current !== null) {
      const loadMoreBtn = wrapper.querySelector(`[data-pagination-action="load_more"]`) as HTMLElement | null;
      if (loadMoreBtn) loadMoreBtn.style.display = ssrLoadMoreBtnDisplayRef.current;
      ssrLoadMoreBtnDisplayRef.current = null;
    }
  }, [getSsrPaginationWrapper]);

  // --- Click intercepts ---

  const paginationInterceptRef = useRef<((e: Event) => void) | null>(null);
  const goToFilteredPageRef = useRef<(page: number) => void>(() => {});
  const handleLoadMoreRef = useRef<() => void>(() => {});

  const syncFilteredPageToUrl = useCallback((page: number) => {
    const url = new URL(window.location.href);
    if (page <= 1) {
      url.searchParams.delete(fpKey);
    } else {
      url.searchParams.set(fpKey, String(page));
    }
    window.history.replaceState({}, '', url.toString());
  }, [fpKey]);

  const goToFilteredPage = useCallback((page: number) => {
    if (page < 1 || page > filteredTotalPages || isFiltering) return;
    const groups = buildApiFilters();
    const offset = (page - 1) * (limit || 10);
    setFilteredPage(page);
    syncFilteredPageToUrl(page);
    fetchFilteredRef.current(groups, offset, false);
  }, [filteredTotalPages, isFiltering, buildApiFilters, limit, syncFilteredPageToUrl]);

  useEffect(() => {
    goToFilteredPageRef.current = goToFilteredPage;
  }, [goToFilteredPage]);

  const handleLoadMore = useCallback(() => {
    if (isFiltering || !filteredHasMore) return;
    const groups = buildApiFilters();
    fetchFilteredRef.current(groups, loadMoreOffsetRef.current, true);
  }, [isFiltering, filteredHasMore, buildApiFilters]);

  useEffect(() => {
    handleLoadMoreRef.current = handleLoadMore;
  }, [handleLoadMore]);

  const attachPaginationIntercept = useCallback(() => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper || paginationInterceptRef.current) return;

    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      const button = target.closest('[data-pagination-action]') as HTMLElement | null;
      if (!button) return;

      e.stopPropagation();
      e.preventDefault();

      const action = button.getAttribute('data-pagination-action');

      if (action === 'prev') {
        goToFilteredPageRef.current(filteredPageRef.current - 1);
      } else if (action === 'next') {
        goToFilteredPageRef.current(filteredPageRef.current + 1);
      } else if (action === 'load_more') {
        handleLoadMoreRef.current();
      }
    };

    wrapper.addEventListener('click', handler, true);
    paginationInterceptRef.current = handler;
  }, [getSsrPaginationWrapper]);

  const detachPaginationIntercept = useCallback(() => {
    const wrapper = getSsrPaginationWrapper();
    if (!wrapper || !paginationInterceptRef.current) return;
    wrapper.removeEventListener('click', paginationInterceptRef.current, true);
    paginationInterceptRef.current = null;
  }, [getSsrPaginationWrapper]);

  const filteredPageRef = useRef(filteredPage);
  useEffect(() => { filteredPageRef.current = filteredPage; }, [filteredPage]);

  // --- Fetch logic ---

  const fetchFiltered = useCallback((
    filterGroups: Array<Array<{ fieldId: string; operator: string; value: string; value2?: string; fieldType?: string }>>,
    offset: number,
    append: boolean,
  ) => {
    const requestKey = JSON.stringify({
      filterGroups,
      offset,
      append,
      sortBy: effectiveSortBy,
      sortOrder: effectiveSortOrder,
      limit,
    });
    if (inFlightRequestKeyRef.current === requestKey) return;

    setIsFiltering(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    inFlightRequestKeyRef.current = requestKey;

    // Get preview user ID if in builder and in preview mode
    const effectivePreviewUserId = (typeof window !== 'undefined' && isPreviewMode) ? previewUserId : null;

    fetch(`/ycode/api/collections/${collectionId}/items/filter`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        ...(effectivePreviewUserId && { 'x-ycode-preview-user-id': effectivePreviewUserId })
      },
      body: JSON.stringify({
        layerTemplate,
        collectionLayerId,
        filterGroups,
        userScope,
        userScopeFieldId,
        sortBy: effectiveSortBy,
        sortOrder: effectiveSortOrder,
        limit,
        offset,
        published: isPublished,
        collectionLayerClasses,
        collectionLayerTag,
      }),
      signal: controller.signal,
    })
      .then(res => {
        if (!res.ok) throw new Error(`Filter API returned ${res.status}`);
        return res.json();
      })
      .then(result => {
        if (result.error) {
          console.error('Filter API error:', result.error);
          setIsFiltering(false);
          return;
        }

        const data = result.data;
        if (!data) {
          setIsFiltering(false);
          return;
        }

        injectFilteredHTML(data.html ?? '', append);

        const total = data.total ?? 0;
        const count = data.count ?? 0;
        const hasMore = data.hasMore ?? false;
        const newOffset = (data.offset ?? 0) + count;

        loadMoreOffsetRef.current = newOffset;
        setFilteredHasMore(hasMore);
        setFilteredTotal(total);
        setFilteredLoaded(newOffset);
        setIsFiltering(false);
        updateEmptyStateElements(total);

        if (paginationMode === 'pages' && limit && limit > 0) {
          setFilteredTotalPages(Math.max(1, Math.ceil(total / limit)));
        }
      })
      .catch(err => {
        if (err.name !== 'AbortError') {
          console.error('Filter fetch failed:', err);
          setIsFiltering(false);
        }
      })
      .finally(() => {
        if (inFlightRequestKeyRef.current === requestKey) {
          inFlightRequestKeyRef.current = null;
          abortRef.current = null;
        }
      });
  }, [collectionId, collectionLayerId, layerTemplate, effectiveSortBy, effectiveSortOrder, limit, paginationMode, updateEmptyStateElements, injectFilteredHTML, collectionLayerClasses, collectionLayerTag, isPublished, userScope, userScopeFieldId, isPreviewMode, previewUserId]);

  const fetchFilteredRef = useRef(fetchFiltered);
  useEffect(() => { fetchFilteredRef.current = fetchFiltered; }, [fetchFiltered]);

  // --- React to filter value changes ---

  useEffect(() => {
    const filterGroups = buildApiFilters();
    const hasActiveInputValues = filters.groups.some(g =>
      g.conditions.some(c => {
        if (!c.inputLayerId) return false;
        for (const layerValues of Object.values(filterValues)) {
          if (c.inputLayerId in layerValues && layerValues[c.inputLayerId]) return true;
        }
        return false;
      })
    );
    const hasRuntimeControls = hasActiveInputValues || hasRuntimeSortOverride || userScope;
    const filterKey = JSON.stringify({
      filterGroups,
      sortBy: effectiveSortBy,
      sortOrder: effectiveSortOrder,
      hasRuntimeControls,
      userScope,
    });

    if (filterKey === prevFilterKeyRef.current) {
      if (pendingFirstEvalRef.current) {
        pendingFirstEvalRef.current = false;
        showSSR();
      }
      return;
    }
    const wasEmpty = prevFilterKeyRef.current === '' || prevFilterKeyRef.current === '[]';

    prevFilterKeyRef.current = filterKey;
    pendingFirstEvalRef.current = false;

    if (!hasRuntimeControls) {
      abortRef.current?.abort();
      abortRef.current = null;

      const cleanUrl = new URL(window.location.href);
      if (cleanUrl.searchParams.has(fpKey)) {
        cleanUrl.searchParams.delete(fpKey);
        window.history.replaceState({}, '', cleanUrl.toString());
      }

      strippedPaginationParamRef.current = false;
      useFilterStore.getState().syncToUrl();

      setHasActiveFilters(false);
      setIsFiltering(false);
      setFilteredHasMore(false);
      setFilteredPage(1);
      setFilteredTotalPages(1);
      setFilteredTotal(0);
      setFilteredLoaded(0);
      loadMoreOffsetRef.current = 0;
      clearFilteredDOM();
      showSSR();
      detachPaginationIntercept();
      restoreSsrPagination();
      const wrapper = getSsrPaginationWrapper();
      if (wrapper) wrapper.style.display = '';
      updateEmptyStateElements(-1);
      return;
    }

    setHasActiveFilters(true);

    const currentUrl = new URL(window.location.href);
    const fpValue = currentUrl.searchParams.get(fpKey);
    const restoredPage = fpValue ? Math.max(1, parseInt(fpValue, 10) || 1) : 1;
    const startPage = wasEmpty ? restoredPage : 1;

    setFilteredPage(startPage);
    loadMoreOffsetRef.current = 0;

    if (startPage <= 1 && currentUrl.searchParams.has(fpKey)) {
      currentUrl.searchParams.delete(fpKey);
      window.history.replaceState({}, '', currentUrl.toString());
    }

    if (currentUrl.searchParams.has(pKey)) {
      currentUrl.searchParams.delete(pKey);
      window.history.replaceState({}, '', currentUrl.toString());
      strippedPaginationParamRef.current = true;
    }

    if (paginationMode === 'pages' || paginationMode === 'load_more') {
      attachPaginationIntercept();
    }

    const startOffset = (startPage - 1) * (limit || 10);
    fetchFiltered(filterGroups, startOffset, false);
  }, [filterValues, buildApiFilters, fetchFiltered, paginationMode, attachPaginationIntercept, detachPaginationIntercept, restoreSsrPagination, getSsrPaginationWrapper, updateEmptyStateElements, fpKey, pKey, limit, hasRuntimeSortOverride, effectiveSortBy, effectiveSortOrder, showSSR, clearFilteredDOM, filters.groups, userScope]);

  useEffect(() => {
    if (!hasActiveFilters || paginationMode !== 'pages') return;
    updateSsrPaginationDisplay(filteredPage, filteredTotalPages);
  }, [hasActiveFilters, paginationMode, filteredPage, filteredTotalPages, updateSsrPaginationDisplay]);

  useEffect(() => {
    if (!hasActiveFilters || paginationMode !== 'load_more') return;
    updateSsrLoadMoreDisplay(filteredLoaded, filteredTotal, filteredHasMore);
  }, [hasActiveFilters, paginationMode, filteredLoaded, filteredTotal, filteredHasMore, updateSsrLoadMoreDisplay]);

  useEffect(() => {
    return () => detachPaginationIntercept();
  }, [detachPaginationIntercept]);

  // Abort any in-flight fetch on unmount
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Loading state: apply opacity to the parent collection layer element
  useEffect(() => {
    const el = getParent();
    if (!el) return;
    if (isFiltering) {
      el.style.opacity = '0.5';
      el.style.pointerEvents = 'none';
    } else {
      el.style.opacity = '';
      el.style.pointerEvents = '';
    }
  }, [isFiltering, getParent]);

  // Zero DOM footprint: invisible marker + direct children
  return (
    <>
      <span ref={markerRef} style={{ display: 'none' }} />
      {children}
    </>
  );
}
