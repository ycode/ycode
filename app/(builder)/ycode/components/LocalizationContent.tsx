'use client';

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import TranslationRow from './TranslationRow';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { InputAutocomplete } from '@/components/ui/input-autocomplete';
import { LOCALES, sanitizeRegionCode, buildLocaleCode, parseLocaleCode, isValidLocaleCode, extractPageTranslatableItems, extractFolderTranslatableItems, extractComponentTranslatableItems, extractCmsTranslatableItems } from '@/lib/localisation-utils';
import { findLayerById } from '@/lib/layer-utils';
import { buildFieldGroupsForLayer } from '@/lib/collection-field-utils';
import type { TranslatableItem } from '@/lib/localisation-utils';
import type { Layer, Page } from '@/types';
import { useLocalisationStore } from '@/stores/useLocalisationStore';
import { usePagesStore } from '@/stores/usePagesStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import { useComponentsStore } from '@/stores/useComponentsStore';
import { buildFolderPath, getPageIcon } from '@/lib/page-utils';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Spinner } from '@/components/ui/spinner';
import type { Locale, LocaleOption } from '@/types';

interface LocalizationContentProps {
  children: React.ReactNode;
}

// Minimum number of characters before a search query is applied.
const MIN_SEARCH_LENGTH = 2;

interface ModalState {
  isOpen: boolean;
  isEditMode: boolean;
  editingLocaleId: string | null;
  selectedLanguage: LocaleOption | null;
  localeCode: string;
  regionCode: string;
  customLocaleName: string;
  isDefaultLocale: boolean;
  localeSearch: string;
}

const initialModalState: ModalState = {
  isOpen: false,
  isEditMode: false,
  editingLocaleId: null,
  selectedLanguage: null,
  localeCode: '',
  regionCode: '',
  customLocaleName: '',
  isDefaultLocale: false,
  localeSearch: '',
};

export default function LocalizationContent({ children }: LocalizationContentProps) {
  // Store (locales are already sorted)
  const locales = useLocalisationStore((state) => state.locales);
  const selectedLocaleId = useLocalisationStore((state) => state.selectedLocaleId);
  const setSelectedLocaleId = useLocalisationStore((state) => state.setSelectedLocaleId);
  const createLocale = useLocalisationStore((state) => state.createLocale);
  const updateLocale = useLocalisationStore((state) => state.updateLocale);
  const deleteLocale = useLocalisationStore((state) => state.deleteLocale);
  const isLoading = useLocalisationStore((state) => state.isLoading);
  const error = useLocalisationStore((state) => state.error);
  const clearError = useLocalisationStore((state) => state.clearError);

  // Translation store functions
  const loadTranslations = useLocalisationStore((state) => state.loadTranslations);
  const getTranslationByKey = useLocalisationStore((state) => state.getTranslationByKey);
  const createTranslation = useLocalisationStore((state) => state.createTranslation);
  const updateTranslation = useLocalisationStore((state) => state.updateTranslation);
  const updateTranslationValue = useLocalisationStore((state) => state.updateTranslationValue);
  const updateTranslationStatus = useLocalisationStore((state) => state.updateTranslationStatus);
  const deleteTranslation = useLocalisationStore((state) => state.deleteTranslation);

  // Pages store
  const storePages = usePagesStore((state) => state.pages);
  const storeFolders = usePagesStore((state) => state.folders);
  const draftsByPageId = usePagesStore((state) => state.draftsByPageId);

  // Components store
  const storeComponents = useComponentsStore((state) => state.components);
  const componentDrafts = useComponentsStore((state) => state.componentDrafts);

  // Collections store (for field names, variables, and items)
  const allFields = useCollectionsStore((state) => state.fields);
  const collections = useCollectionsStore((state) => state.collections);
  const items = useCollectionsStore((state) => state.items);

  /**
   * Build CMS variable field groups for a translation item using the same
   * resolution rules as the canvas right-sidebar: walks parent collection
   * layers and merges page-bound collection fields. Custom code items resolve
   * against the page's own collection, matching the page settings editor.
   * Returns `undefined` for the rest (slug, SEO, CMS field translations) so the
   * picker stays hidden where the canvas wouldn't show one either.
   */
  const buildFieldGroupsForTranslationItem = (
    item: TranslatableItem,
    layers: Layer[],
    page?: Page | null,
  ) => {
    if (item.content_key.startsWith('custom_code:')) {
      const collectionId = page?.is_dynamic ? page.settings?.cms?.collection_id : null;
      const fields = collectionId ? allFields[collectionId] : undefined;
      return fields?.length ? [{ fields }] : undefined;
    }

    const match = item.content_key.match(/^layer:([^:]+):/);
    if (!match) return undefined;
    const layerId = match[1];
    if (!findLayerById(layers, layerId)) return undefined;
    return buildFieldGroupsForLayer(layerId, layers, page || null, allFields, collections);
  };

  /**
   * Resolve the layer behind a translation item so the editor gets layer context
   * (e.g. to expose pagination variables for count/info layers).
   */
  const findLayerForTranslationItem = (
    item: TranslatableItem,
    layers: Layer[],
  ): Layer | null => {
    const match = item.content_key.match(/^layer:([^:]+):/);
    if (!match) return null;
    return findLayerById(layers, match[1]) || null;
  };

  // URL management
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Initialize state from URL params
  const [modalState, setModalState] = useState<ModalState>(initialModalState);
  const [selectedContentType, setSelectedContentType] = useState<string>(() => {
    return searchParams?.get('type') || 'pages';
  });
  const [completionFilter, setCompletionFilter] = useState<'all' | 'done' | 'todo'>(() => {
    const filter = searchParams?.get('filter');
    return (filter === 'done' || filter === 'todo') ? filter : 'all';
  });
  const [searchQuery, setSearchQuery] = useState<string>(() => {
    return searchParams?.get('search') || '';
  });
  const isSearchActive = searchQuery.trim().length >= MIN_SEARCH_LENGTH;
  const [expandedPages, setExpandedPages] = useState<Set<string>>(new Set());
  // Local input values for immediate UI feedback (keyed by item.key)
  const [localInputValues, setLocalInputValues] = useState<Record<string, string>>({});

  // Track if we've initialized from URL to prevent race conditions
  const hasInitializedFromUrl = useRef(false);

  const selectedLocale = locales.find(l => l.id === selectedLocaleId);
  const defaultLocale = locales.find(l => l.is_default);

  // Initialize selected locale from URL when locales are loaded (runs once)
  useEffect(() => {
    if (hasInitializedFromUrl.current || locales.length === 0) return;

    const localeCodeFromUrl = searchParams?.get('locale');
    if (localeCodeFromUrl) {
      const localeFromUrl = locales.find(l => l.code === localeCodeFromUrl);
      if (localeFromUrl) {
        setSelectedLocaleId(localeFromUrl.id);
      }
    }

    hasInitializedFromUrl.current = true;
  }, [locales, searchParams, setSelectedLocaleId]);

  // Load translations when locale changes
  useEffect(() => {
    if (selectedLocaleId) {
      loadTranslations(selectedLocaleId);
      // Clear local input values when switching locales
      setLocalInputValues({});
    }
  }, [selectedLocaleId, loadTranslations]);

  // Sync URL params with filter state and selected locale (localization route only)
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString() || '');

    // Update or remove type param
    if (selectedContentType !== 'pages') {
      params.set('type', selectedContentType);
    } else {
      params.delete('type');
    }

    // Update or remove filter param
    if (completionFilter !== 'all') {
      params.set('filter', completionFilter);
    } else {
      params.delete('filter');
    }

    // Update or remove search param
    if (searchQuery.trim()) {
      params.set('search', searchQuery);
    } else {
      params.delete('search');
    }

    // Update or remove locale param (don't add for default locale)
    if (selectedLocale && !selectedLocale.is_default) {
      params.set('locale', selectedLocale.code);
    } else {
      params.delete('locale');
    }

    // Update URL without reloading (only if something changed)
    const newQuery = params.toString();
    const currentQuery = searchParams?.toString() || '';
    if (newQuery !== currentQuery) {
      router.replace(`${pathname}${newQuery ? `?${newQuery}` : ''}`, { scroll: false });
    }
  }, [selectedContentType, completionFilter, searchQuery, selectedLocale, router, pathname, searchParams]);

  // Cleanup: Remove localization params when component unmounts
  useEffect(() => {
    return () => {
      // Get current search params at unmount time
      const currentParams = new URLSearchParams(window.location.search);

      // Check if any localization params exist
      const hasLocalizationParams =
        currentParams.has('type') ||
        currentParams.has('filter') ||
        currentParams.has('search') ||
        currentParams.has('locale');

      if (hasLocalizationParams) {
        // Remove localization-specific params
        currentParams.delete('type');
        currentParams.delete('filter');
        currentParams.delete('search');
        currentParams.delete('locale');

        const cleanedQuery = currentParams.toString();
        const newPath = window.location.pathname + (cleanedQuery ? `?${cleanedQuery}` : '');
        // Use history.replaceState to avoid triggering navigation
        window.history.replaceState({}, '', newPath);
      }
    };
  }, []); // Empty deps - only run on mount/unmount

  // Filter translatable items based on completion status and search query
  const filterTranslatableItems = (items: any[]) => {
    return items.filter(item => {
      // Filter by completion status
      if (completionFilter !== 'all' && selectedLocaleId) {
        const translation = getTranslationByKey(selectedLocaleId, item.key);

        if (completionFilter === 'done' && translation?.is_completed !== true) {
          return false;
        } else if (completionFilter === 'todo' && translation?.is_completed === true) {
          return false;
        }
      }

      // Filter by search query (requires a minimum query length)
      if (isSearchActive) {
        const query = searchQuery.toLowerCase().trim();
        const originalContent = item.content_value?.toLowerCase() || '';
        const label = item.info?.label?.toLowerCase() || '';
        const description = item.info?.description?.toLowerCase() || '';

        // Get translated content
        let translatedContent = '';
        if (selectedLocaleId) {
          const translation = getTranslationByKey(selectedLocaleId, item.key);
          translatedContent = translation?.content_value?.toLowerCase() || '';
        }

        // Check if query matches any of the searchable fields
        const matchesOriginal = originalContent.includes(query);
        const matchesTranslation = translatedContent.includes(query);
        const matchesLabel = label.includes(query);
        const matchesDescription = description.includes(query);

        if (!matchesOriginal && !matchesTranslation && !matchesLabel && !matchesDescription) {
          return false;
        }
      }

      return true;
    });
  };

  // Sort pages: by folder hierarchy order, then page order, error pages at the bottom
  const sortedPages = useMemo(() => {
    // Get ancestor folder at a specific depth
    const getAncestorAtDepth = (page: typeof storePages[0], targetDepth: number): { id: string | null; order: number; isFolder: boolean } => {
      if (page.depth === targetDepth) {
        return { id: page.page_folder_id, order: page.order ?? 0, isFolder: false };
      }

      // Page is deeper, find its ancestor folder at targetDepth
      let currentFolderId = page.page_folder_id;
      while (currentFolderId) {
        const folder = storeFolders.find(f => f.id === currentFolderId);
        if (!folder) break;

        if (folder.depth === targetDepth) {
          return { id: currentFolderId, order: folder.order ?? 0, isFolder: true };
        }

        currentFolderId = folder.page_folder_id;
      }

      return { id: null, order: page.order ?? 0, isFolder: false };
    };

    return [...storePages].sort((a, b) => {
      // Error pages at the bottom
      const aIsError = a.error_page !== null;
      const bIsError = b.error_page !== null;
      if (aIsError && !bIsError) return 1;
      if (!aIsError && bIsError) return -1;

      // Find the shallower depth to compare at
      const compareDepth = Math.min(a.depth, b.depth);

      // Get ancestors at the comparison depth
      const aAncestor = getAncestorAtDepth(a, compareDepth);
      const bAncestor = getAncestorAtDepth(b, compareDepth);

      // Compare orders at the same depth level
      const orderDiff = aAncestor.order - bAncestor.order;
      if (orderDiff !== 0) return orderDiff;

      // If same order at comparison depth, shallower items come first
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }

      // Same depth and order, compare by page order
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }, [storePages, storeFolders]);

  // Sort folders: by hierarchy order
  const sortedFolders = useMemo(() => {
    return [...storeFolders].sort((a, b) => {
      // Compare by depth first (shallower first)
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }

      // Same depth, compare by order
      return (a.order ?? 0) - (b.order ?? 0);
    });
  }, [storeFolders]);

  // Ordered ids of the collapsible sections for the active content type.
  // Pages and CMS items share the same accordion/expansion behaviour.
  const sectionIds = useMemo(() => {
    if (selectedContentType === 'cms') {
      return collections.flatMap(collection =>
        (items[collection.id] || [])
          .filter(item => !item.is_published)
          .map(item => item.id)
      );
    }
    return sortedPages.map(p => p.id);
  }, [selectedContentType, collections, items, sortedPages]);

  // Expand only the first section by default — rendering every section's
  // translation rows at once slows the page considerably. Re-initialises when
  // the content type changes (so switching to CMS expands its first item),
  // but collapsing sections within a type doesn't re-trigger the auto-expand.
  const initializedExpandedType = useRef<string | null>(null);
  useEffect(() => {
    if (initializedExpandedType.current === selectedContentType) return;
    if (sectionIds.length === 0) return;
    // Respect a deep-linked search: expand all when active, else first only.
    setExpandedPages(
      isSearchActive ? new Set(sectionIds) : new Set([sectionIds[0]])
    );
    initializedExpandedType.current = selectedContentType;
  }, [selectedContentType, sectionIds, isSearchActive]);

  // Update the search query and adjust section expansion in the SAME batched
  // update. Doing this in a follow-up effect would briefly render an
  // intermediate state (search inactive but all sections still expanded ⇒
  // every section's items rendered at once), which is very slow on large sites.
  // While searching, expand all sections so matches are visible; when search
  // drops below the threshold, collapse back to just the first (accordion).
  const handleSearchChange = (value: string) => {
    const nowActive = value.trim().length >= MIN_SEARCH_LENGTH;
    if (nowActive !== isSearchActive) {
      setExpandedPages(
        nowActive
          ? new Set(sectionIds)
          : new Set(sectionIds.length > 0 ? [sectionIds[0]] : [])
      );
    }
    setSearchQuery(value);
  };

  // Build full page path segments for display
  const getPagePathSegments = (page: typeof sortedPages[0]): string[] => {
    const folder = page.page_folder_id ? storeFolders.find(f => f.id === page.page_folder_id) : null;
    const folderSegments = folder ? (buildFolderPath(folder, storeFolders, true) as string[]) : [];
    return [...folderSegments, page.name];
  };

  // Refs for scrolling a freshly-expanded section to the top of the viewport.
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingScrollPageId = useRef<string | null>(null);

  const togglePageExpansion = (pageId: string) => {
    setExpandedPages(prev => {
      const next = new Set(prev);
      if (next.has(pageId)) {
        next.delete(pageId);
      } else {
        // Accordion: only one section open at a time, unless a search is
        // active (then matching sections can stay expanded together).
        if (!isSearchActive) {
          next.clear();
        }
        next.add(pageId);
        // Scroll this section to the top once it's expanded (and others
        // collapsed) — handled in an effect after the layout settles.
        pendingScrollPageId.current = pageId;
      }
      return next;
    });
  };

  // After expansion changes, scroll the just-expanded section's header just
  // below the sticky toolbar. rAF waits for the collapse/expand layout shift.
  useEffect(() => {
    const pageId = pendingScrollPageId.current;
    if (!pageId) return;
    pendingScrollPageId.current = null;

    const container = scrollContainerRef.current;
    const section = sectionRefs.current.get(pageId);
    if (!container || !section) return;

    requestAnimationFrame(() => {
      const TOOLBAR_HEIGHT = 64; // sticky toolbar (h-16)
      const delta =
        section.getBoundingClientRect().top -
        container.getBoundingClientRect().top -
        TOOLBAR_HEIGHT;
      container.scrollTo({ top: container.scrollTop + delta, behavior: 'smooth' });
    });
  }, [expandedPages]);

  // Helper functions for managing local input values
  const handleLocalValueChange = (key: string, value: string) => {
    setLocalInputValues(prev => ({
      ...prev,
      [key]: value,
    }));
  };

  const handleLocalValueClear = (key: string) => {
    setLocalInputValues(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // Filter out locales that already exist
  const existingLocaleCodes = new Set(locales.map(l => l.code));
  const availableLocales = LOCALES.filter(l => !existingLocaleCodes.has(l.code));

  // Combine the picker-driven base language with the editable region subtag,
  // then validate the result against its BCP-47 shape and existing locales
  // (excluding the one currently being edited).
  const fullLocaleCode = buildLocaleCode(modalState.localeCode, modalState.regionCode);
  const isDuplicateLocaleCode = locales.some(
    l => l.code === fullLocaleCode && l.id !== modalState.editingLocaleId
  );
  const isLocaleCodeValid = !!modalState.localeCode && isValidLocaleCode(fullLocaleCode) && !isDuplicateLocaleCode;

  const localeCodeError = (() => {
    if (!modalState.localeCode || !modalState.regionCode) return null;
    if (isDuplicateLocaleCode) return 'This locale code already exists.';
    if (!isValidLocaleCode(fullLocaleCode)) return 'Enter a valid region like "BE".';
    return null;
  })();

  const handleAddLocale = async () => {
    if (!isLocaleCodeValid || !modalState.customLocaleName.trim()) {
      return;
    }

    try {
      const newLocale = await createLocale({
        code: fullLocaleCode,
        label: modalState.customLocaleName.trim(),
        is_default: modalState.isDefaultLocale,
      });

      if (newLocale) {
        setSelectedLocaleId(newLocale.id);
        setModalState(prev => ({ ...prev, isOpen: false }));
      }
    } catch (error) {
      console.error('Failed to create locale:', error);
    }
  };

  const handleUpdateLocale = async () => {
    if (!modalState.editingLocaleId || !isLocaleCodeValid || !modalState.customLocaleName.trim()) {
      return;
    }

    try {
      await updateLocale(modalState.editingLocaleId, {
        code: fullLocaleCode,
        label: modalState.customLocaleName.trim(),
        is_default: modalState.isDefaultLocale,
      });

      setModalState(prev => ({ ...prev, isOpen: false }));
    } catch (error) {
      console.error('Failed to update locale:', error);
    }
  };

  const handleDeleteLocale = async () => {
    if (!modalState.editingLocaleId) {
      return;
    }

    try {
      await deleteLocale(modalState.editingLocaleId);
      setModalState(initialModalState);
    } catch (error) {
      console.error('Failed to delete locale:', error);
    }
  };

  const handleOpenEditDialog = (locale: Locale) => {
    clearError();

    // Split the stored code into its base language and region parts so each
    // maps to its own input.
    const { language, region } = parseLocaleCode(locale.code);
    const localeOption = LOCALES.find(l => l.code === language);

    setModalState({
      isOpen: true,
      isEditMode: true,
      editingLocaleId: locale.id,
      customLocaleName: locale.label,
      localeCode: language,
      regionCode: region,
      isDefaultLocale: locale.is_default,
      selectedLanguage: localeOption || null,
      localeSearch: localeOption?.label || '',
    });
  };

  const handleCloseDialog = () => {
    setModalState(prev => ({ ...prev, isOpen: false }));
    clearError();
  };

  const handleSelectLanguage = (locale: LocaleOption | null) => {
    clearError();

    if (!locale) {
      setModalState(prev => ({
        ...prev,
        selectedLanguage: null,
        localeSearch: '',
        localeCode: '',
        regionCode: '',
        customLocaleName: '',
      }));
      return;
    }

    const { language, region } = parseLocaleCode(locale.code);

    setModalState(prev => ({
      ...prev,
      localeSearch: locale.label,
      selectedLanguage: locale,
      localeCode: language,
      regionCode: region,
      customLocaleName: locale.label,
    }));
  };

  return (
    <div className="flex flex-1 overflow-hidden">
      {/* Left Sidebar */}
      <div className="w-64 border-r flex flex-col px-4">
        <header className="py-5 flex justify-between items-center">
          <span className="font-medium">Localization</span>
          <Button
            size="xs"
            variant="secondary"
            onClick={() => {
              clearError();
              setModalState({
                ...initialModalState,
                isOpen: true,
              });
            }}
          >
            <Icon name="plus" className="size-3" />
          </Button>
        </header>

        <div className="flex-1 overflow-y-auto">
          <div className="space-y-0">
            {locales.map((locale) => {
              const isActive = selectedLocaleId === locale.id;

              return (
                <div
                  key={locale.id}
                  className={cn(
                    'group relative flex items-center h-8 rounded-lg w-full px-2 gap-1.5',
                    'hover:bg-secondary/50 cursor-pointer',
                    isActive && 'bg-primary text-primary-foreground hover:bg-primary',
                    !isActive && 'text-secondary-foreground/80 dark:text-muted-foreground'
                  )}
                  onClick={() => setSelectedLocaleId(locale.id)}
                >
                  <div className="flex items-center flex-1 outline-none focus:outline-none select-none text-left text-xs gap-1.5 min-w-0">
                    <span className="bg-secondary text-secondary-foreground text-[10px] font-semibold py-0.5 px-1.5 rounded-[6px] uppercase shrink-0">{locale.code}</span>
                    <Label className="cursor-[inherit] min-w-0 flex-1">
                      <div className="truncate">{locale.label}</div>
                    </Label>
                    {locale.is_default && <Badge variant="secondary" className="shrink-0 ml-auto text-[10px]">Default</Badge>}
                  </div>

                  <Button
                    size="xs"
                    variant="ghost"
                    className="hidden group-hover:flex"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenEditDialog(locale);
                    }}
                  >
                    <Icon name="more" className="size-3" />
                  </Button>
                </div>
              );
            })}
            {locales.length === 0 && (
              <div className="px-2 py-4 text-xs text-muted-foreground">
                {isLoading.load ? 'Loading locales...' : 'No locales added yet'}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto">
        {selectedLocale ? (
          <div className="flex flex-col min-h-full">
            <div className="sticky top-0 z-10 h-16 bg-background p-4 flex items-center gap-2 border-b">
              <div>
                <Select value={selectedContentType} onValueChange={setSelectedContentType}>
                  <SelectTrigger className="w-34">
                    <SelectValue placeholder="Select..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pages"><Icon name="page" className="size-3" /> Pages</SelectItem>
                    <SelectItem value="folders"><Icon name="folder" className="size-3" /> Folders</SelectItem>
                    <SelectItem value="components"><Icon name="component" className="size-3" /> Components</SelectItem>
                    <SelectItem value="cms"><Icon name="database" className="size-3" /> CMS</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Select value={completionFilter} onValueChange={(value: 'all' | 'done' | 'todo') => setCompletionFilter(value)}>
                  <SelectTrigger className="w-38">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>

                  <SelectContent>
                    <SelectItem value="all"><Icon name="checkbox" className="size-3" />All translations</SelectItem>
                    <SelectItem value="todo"><Icon name="block" className="size-3" /> To be translated</SelectItem>
                    <SelectItem value="done"><Icon name="checkbox" className="size-3" /> Marked as done</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="w-full max-w-80">
                <InputGroup>
                  <InputGroupInput
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                  />
                  <InputGroupAddon>
                    <Icon name="search" className="size-3" />
                  </InputGroupAddon>
                </InputGroup>
              </div>

              {/*
              <div className="ml-auto">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={true}
                >
                  Auto-translate
                </Button>
              </div>
              */}
            </div>

            {/* Loading state */}
            {isLoading.loadTranslations ? (
              <div className="flex items-center justify-center flex-1">
                <div className="flex flex-col items-center gap-3">
                  <Spinner />
                  <p className="text-sm text-muted-foreground">Loading translations...</p>
                </div>
              </div>
            ) : (
              <>
                {/* Default locale selected overlay */}
                {selectedLocale.is_default ? (
                  <>
                    <Empty>
                  <EmptyMedia variant="icon">
                    <Icon name="globe" className="size-4" />
                  </EmptyMedia>
                  <EmptyTitle>Default locale selected</EmptyTitle>
                  <EmptyDescription>
                    Please select a different locale to start translating.
                  </EmptyDescription>
                </Empty>

                    <div className="flex-1"></div>
                  </>
                ) : (
                  <>
                    {selectedContentType === 'pages' && (
                  <div>
                    {sortedPages.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground text-sm">
                        No pages found
                      </div>
                    ) : (
                      sortedPages.map((page) => {
                        // Pre-check if page has any filtered items
                        const draft = draftsByPageId[page.id];
                        const layers = draft?.layers || [];
                        const selectedLocale = locales.find(l => l.id === selectedLocaleId);
                        const translatableItems = extractPageTranslatableItems(page, layers, selectedLocale, storeComponents);
                        const filteredItems = filterTranslatableItems(translatableItems);

                        if (filteredItems.length === 0) {
                          return null;
                        }

                        const isExpanded = expandedPages.has(page.id);

                        return (
                          <div
                            key={page.id}
                            ref={(el) => {
                              if (el) sectionRefs.current.set(page.id, el);
                              else sectionRefs.current.delete(page.id);
                            }}
                          >
                            <header
                              className="sticky top-16 z-5 border-b cursor-pointer bg-background"
                              onClick={() => togglePageExpansion(page.id)}
                            >
                              <div className="p-4 flex items-center gap-1.5 bg-secondary/10 hover:bg-secondary/35 transition-colors">
                                <Icon
                                  name="chevronRight"
                                  className={cn(
                                    'size-3 transition-transform',
                                    isExpanded && 'rotate-90'
                                  )}
                                />

                                <div className="size-5.5 flex items-center justify-center rounded-[6px] bg-secondary/50">
                                  <Icon name={getPageIcon(page)} className="size-3 opacity-60" />
                                </div>

                                <Label className="flex items-center gap-1 cursor-pointer">
                                  {getPagePathSegments(page).map((segment, index, array) => (
                                    <React.Fragment key={index}>
                                      <span>{segment}</span>
                                      {index < array.length - 1 && (
                                        <Icon name="chevronRight" className="size-3 opacity-60" />
                                      )}
                                    </React.Fragment>
                                  ))}
                                </Label>

                                <span className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
                                  <span>{defaultLocale?.label}</span>
                                  <Icon name="chevronRight" className="size-3 inline" />
                                  <span>{selectedLocale?.label}</span>
                                </span>
                              </div>
                            </header>

                            {isExpanded && (
                              <ul className="border-b px-4 py-5 flex flex-col gap-5">
                                {filteredItems.map((item) => (
                                  <TranslationRow
                                    key={item.key}
                                    item={item}
                                    selectedLocaleId={selectedLocaleId}
                                    localInputValues={localInputValues}
                                    onLocalValueChange={handleLocalValueChange}
                                    onLocalValueClear={handleLocalValueClear}
                                    getTranslationByKey={getTranslationByKey}
                                    createTranslation={createTranslation}
                                    updateTranslation={updateTranslation}
                                    updateTranslationValue={updateTranslationValue}
                                    updateTranslationStatus={updateTranslationStatus}
                                    deleteTranslation={deleteTranslation}
                                    fieldGroups={buildFieldGroupsForTranslationItem(item, layers, page)}
                                    layer={findLayerForTranslationItem(item, layers)}
                                    allFields={allFields}
                                    collections={collections}
                                    pages={storePages}
                                    folders={storeFolders}
                                    sourceItem={page}
                                  />
                                ))}
                              </ul>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                    )}

                {selectedContentType === 'folders' && (
                    <div>
                      {sortedFolders.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground text-sm">
                        No folders found
                      </div>
                      ) : (
                        sortedFolders.map((folder) => {
                          const selectedLocale = locales.find(l => l.id === selectedLocaleId);
                          const translatableItems = extractFolderTranslatableItems(folder, selectedLocale);
                          const filteredItems = filterTranslatableItems(translatableItems);

                          if (filteredItems.length === 0) {
                            return null;
                          }

                          // Build full folder path for display
                          const folderPath = buildFolderPath(folder, storeFolders, true) as string[];

                          return (
                          <div key={folder.id}>
                            <header className="sticky top-16 z-5 border-b bg-background">
                              <div className="p-4 flex items-center gap-1.5 bg-secondary/10">
                                <div className="size-5.5 flex items-center justify-center rounded-[6px] bg-secondary/50">
                                  <Icon name="folder" className="size-3 opacity-60" />
                                </div>

                                <Label className="flex items-center gap-1">
                                  {folderPath.map((segment, index, array) => (
                                    <React.Fragment key={index}>
                                      <span>{segment}</span>
                                      {index < array.length - 1 && (
                                        <Icon name="chevronRight" className="size-3 opacity-60" />
                                      )}
                                    </React.Fragment>
                                  ))}
                                </Label>

                                <span className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
                                  <span>{defaultLocale?.label}</span>
                                  <Icon name="chevronRight" className="size-3 inline" />
                                  <span>{selectedLocale?.label}</span>
                                </span>
                              </div>
                            </header>

                            <ul className="border-b px-4 py-5 flex flex-col gap-5">
                              {filteredItems.map((item) => (
                                <TranslationRow
                                  key={item.key}
                                  item={item}
                                  selectedLocaleId={selectedLocaleId}
                                  localInputValues={localInputValues}
                                  onLocalValueChange={handleLocalValueChange}
                                  onLocalValueClear={handleLocalValueClear}
                                  getTranslationByKey={getTranslationByKey}
                                  createTranslation={createTranslation}
                                  updateTranslation={updateTranslation}
                                  updateTranslationValue={updateTranslationValue}
                                  updateTranslationStatus={updateTranslationStatus}
                                  deleteTranslation={deleteTranslation}
                                  pages={storePages}
                                  folders={storeFolders}
                                  sourceItem={folder}
                                />
                              ))}
                            </ul>
                          </div>
                          );
                        })
                      )}
                  </div>
                )}

                {selectedContentType === 'components' && (
                  <div>
                    {storeComponents.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground text-sm">
                        No components found
                      </div>
                    ) : (
                      storeComponents.map((component) => {
                        // Translations live on the master component's primary
                        // variant. Pick the active draft if there is one,
                        // otherwise fall back to the persisted variants[0]
                        // layers (mirrored into `component.layers`).
                        const draftVariants = componentDrafts[component.id];
                        const primaryVariantId = component.variants && component.variants.length > 0
                          ? component.variants[0].id
                          : null;
                        const layers = (primaryVariantId && draftVariants?.[primaryVariantId])
                          || component.layers
                          || [];
                        const translatableItems = extractComponentTranslatableItems(component, layers);
                        const filteredItems = filterTranslatableItems(translatableItems);

                        if (filteredItems.length === 0) {
                          return null;
                        }

                        return (
                          <div key={component.id}>
                            <header className="sticky top-16 z-5 border-b bg-background">
                              <div className="p-4 flex items-center gap-1.5 bg-secondary/10">
                                <div className="size-5.5 flex items-center justify-center rounded-[6px] bg-secondary/50">
                                  <Icon name="component" className="size-3 opacity-60" />
                                </div>

                                <Label>{component.name}</Label>

                                <span className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
                                  <span>{defaultLocale?.label}</span>
                                  <Icon name="chevronRight" className="size-3 inline" />
                                  <span>{selectedLocale?.label}</span>
                                </span>
                              </div>
                            </header>

                            <ul className="border-b px-4 py-5 flex flex-col gap-5">
                              {filteredItems.map((item) => (
                                <TranslationRow
                                  key={item.key}
                                  item={item}
                                  selectedLocaleId={selectedLocaleId}
                                  localInputValues={localInputValues}
                                  onLocalValueChange={handleLocalValueChange}
                                  onLocalValueClear={handleLocalValueClear}
                                  getTranslationByKey={getTranslationByKey}
                                  createTranslation={createTranslation}
                                  updateTranslation={updateTranslation}
                                  updateTranslationValue={updateTranslationValue}
                                  updateTranslationStatus={updateTranslationStatus}
                                  deleteTranslation={deleteTranslation}
                                  fieldGroups={buildFieldGroupsForTranslationItem(item, layers)}
                                  layer={findLayerForTranslationItem(item, layers)}
                                  allFields={allFields}
                                  collections={collections}
                                />
                              ))}
                            </ul>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}

                {selectedContentType === 'cms' && (
                  <div>
                    {collections.length === 0 ? (
                      <div className="p-8 text-center text-muted-foreground text-sm">
                        No collections found
                      </div>
                    ) : (
                      collections.flatMap((collection) => {
                        // Get items for this collection
                        const collectionItems = items[collection.id] || [];
                        const collectionFields = allFields[collection.id] || [];

                        // Filter for only draft items (builder context uses drafts)
                        const draftItems = collectionItems.filter(item => !item.is_published);

                        if (draftItems.length === 0) {
                          return [];
                        }

                        return draftItems.map((item: any) => {
                          const selectedLocale = locales.find(l => l.id === selectedLocaleId);
                          const translatableItems = extractCmsTranslatableItems(
                            item,
                            collectionFields,
                            selectedLocale
                          );
                          const filteredItems = filterTranslatableItems(translatableItems);

                          if (filteredItems.length === 0) {
                            return null;
                          }

                          // Get item name from first text field or use ID
                          const nameField = collectionFields.find(f => f.type === 'text' && f.fillable);
                          const itemName = nameField ? item.values[nameField.id] || item.id.substring(0, 8) : item.id.substring(0, 8);

                          const isExpanded = expandedPages.has(item.id);

                          return (
                            <div
                              key={item.id}
                              ref={(el) => {
                                if (el) sectionRefs.current.set(item.id, el);
                                else sectionRefs.current.delete(item.id);
                              }}
                            >
                              <header
                                className="sticky top-16 z-5 border-b cursor-pointer bg-background"
                                onClick={() => togglePageExpansion(item.id)}
                              >
                                <div className="p-4 flex items-center gap-1.5 bg-secondary/10 hover:bg-secondary/35 transition-colors">
                                  <Icon
                                    name="chevronRight"
                                    className={cn(
                                      'size-3 transition-transform',
                                      isExpanded && 'rotate-90'
                                    )}
                                  />

                                  <div className="size-5.5 flex items-center justify-center rounded-[6px] bg-secondary/50">
                                    <Icon name="database" className="size-3 opacity-60" />
                                  </div>

                                  <Label className="cursor-pointer">{collection.name} <span className="text-muted-foreground">›</span> {itemName}</Label>

                                  <span className="flex items-center gap-1.5 ml-auto text-xs text-muted-foreground">
                                  <span>{defaultLocale?.label}</span>
                                  <Icon name="chevronRight" className="size-3 inline" />
                                  <span>{selectedLocale?.label}</span>
                                </span>
                                </div>
                              </header>

                              {isExpanded && (
                                <ul className="border-b px-4 py-5 flex flex-col gap-5">
                                  {filteredItems.map((transItem) => (
                                    <TranslationRow
                                      key={transItem.key}
                                      item={transItem}
                                      selectedLocaleId={selectedLocaleId}
                                      localInputValues={localInputValues}
                                      onLocalValueChange={handleLocalValueChange}
                                      onLocalValueClear={handleLocalValueClear}
                                      getTranslationByKey={getTranslationByKey}
                                      createTranslation={createTranslation}
                                      updateTranslation={updateTranslation}
                                      updateTranslationValue={updateTranslationValue}
                                      updateTranslationStatus={updateTranslationStatus}
                                      deleteTranslation={deleteTranslation}
                                      allFields={allFields}
                                      collections={collections}
                                      pages={storePages}
                                      folders={storeFolders}
                                      sourceItem={undefined}
                                    />
                                  ))}
                                </ul>
                              )}
                            </div>
                          );
                        }).filter(Boolean);
                      })
                    )}
                  </div>
                )}
                  </>
                )}
              </>
            )}
            </div>
        ) : (
          children
        )}
      </div>

      {/* Add/Edit Locale Dialog */}
      <Dialog open={modalState.isOpen} onOpenChange={(open) => !open && handleCloseDialog()}>
        <DialogContent
          aria-describedby={undefined}
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{modalState.isEditMode ? 'Edit locale' : 'Add locale'}</DialogTitle>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            {error && (
              <div className="px-3 py-2 text-xs text-destructive bg-destructive/10 rounded-md">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="language">Locale</Label>

              <InputAutocomplete
                id="language"
                search={modalState.localeSearch}
                onSearchChange={(value) => setModalState(prev => ({ ...prev, localeSearch: value }))}
                options={availableLocales}
                selected={modalState.selectedLanguage}
                onSelect={handleSelectLanguage}
                placeholder="Search for a locale"
                searchableKeys={['label', 'native_label', 'code']}
                disabled={modalState.isEditMode}
                renderItem={(locale) => (
                  <div className="flex items-center justify-between px-1.5 py-1.25 text-xs">
                    <div className="flex items-center gap-2">
                      <span>{locale.label}</span>
                      <span className="text-muted-foreground">{locale.native_label}</span>
                    </div>
                    <Badge variant="secondary" className="uppercase text-[10px]">
                      {locale.code}
                    </Badge>
                  </div>
                )}
                renderEmpty={() => (
                  <div className="px-3 py-6 text-center text-muted-foreground text-xs">
                    No locales found
                  </div>
                )}
              />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex gap-3">
                <div className="flex flex-col gap-2 flex-1">
                  <div className="flex items-center gap-2">
                    <Label htmlFor="name">Custom name</Label>
                    {fullLocaleCode && (
                      <span className="text-xs text-muted-foreground uppercase">{fullLocaleCode}</span>
                    )}
                  </div>
                  <Input
                    id="name"
                    value={modalState.customLocaleName}
                    onChange={(e) => setModalState(prev => ({ ...prev, customLocaleName: e.target.value }))}
                    placeholder="Custom name"
                  />
                </div>
                <div className="flex flex-col gap-2 w-24">
                  <Label htmlFor="code" className="whitespace-nowrap">Locale code</Label>
                  <Input
                    id="code"
                    value={modalState.localeCode}
                    disabled
                    placeholder="Code"
                    className={modalState.localeCode ? 'uppercase' : ''}
                  />
                </div>
                <div className="flex flex-col gap-2 w-24">
                  <Label htmlFor="region" className="whitespace-nowrap">Regional code</Label>
                  <Input
                    id="region"
                    value={modalState.regionCode}
                    onChange={(e) => setModalState(prev => ({ ...prev, regionCode: sanitizeRegionCode(e.target.value) }))}
                    placeholder="e.g. BE"
                    disabled={!modalState.localeCode}
                    className={cn(modalState.regionCode && 'uppercase', localeCodeError && 'border-destructive')}
                  />
                </div>
              </div>
              {localeCodeError && (
                <span className="text-xs text-destructive">{localeCodeError}</span>
              )}
            </div>

            {(() => {
              const editingLocale = modalState.isEditMode
                ? locales.find(l => l.id === modalState.editingLocaleId)
                : null;
              const isCurrentlyDefault = editingLocale?.is_default ?? false;
              const shouldDisable = modalState.isEditMode && isCurrentlyDefault;

              return (
                <div className="mt-1 flex items-start gap-2">
                  <Checkbox
                    id="is-default"
                    checked={modalState.isDefaultLocale}
                    onCheckedChange={(checked) => setModalState(prev => ({ ...prev, isDefaultLocale: checked === true }))}
                    disabled={shouldDisable}
                  />

                  <Label
                    htmlFor="is-default"
                    className={cn('cursor-pointer flex-col items-start gap-0.5', shouldDisable && 'cursor-not-allowed opacity-50')}
                  >
                    <span>Set as default locale</span>
                    <span className="text-muted-foreground/75">All your pages and CMS contents should be written in this locale.</span>
                  </Label>
                </div>
              );
            })()}
          </div>

          <DialogFooter className="justify-between">
            {modalState.isEditMode && (() => {
              const editingLocale = locales.find(l => l.id === modalState.editingLocaleId);
              const isCurrentlyDefault = editingLocale?.is_default ?? false;
              const isOnlyLocale = locales.length === 1;
              const isDisabled = isLoading.delete || isOnlyLocale || isCurrentlyDefault;

              let tooltipMessage = '';
              if (isCurrentlyDefault) {
                tooltipMessage = 'Cannot delete the default locale';
              } else if (isOnlyLocale) {
                tooltipMessage = 'Cannot delete the only locale';
              }

              const button = (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleDeleteLocale}
                  size="sm"
                  disabled={isDisabled}
                >
                  <Icon name="trash" className="size-3" />
                  Delete
                </Button>
              );

              if (isDisabled && tooltipMessage && !isLoading.delete) {
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      {button}
                    </TooltipTrigger>
                    <TooltipContent>
                      {tooltipMessage}
                    </TooltipContent>
                  </Tooltip>
                );
              }

              return button;
            })()}

            <div className="flex gap-2 ml-auto">
              <Button
                type="button"
                variant="secondary"
                onClick={handleCloseDialog}
                size="sm"
                disabled={isLoading.create || isLoading.update || isLoading.delete}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={modalState.isEditMode ? handleUpdateLocale : handleAddLocale}
                disabled={
                  modalState.isEditMode
                    ? !isLocaleCodeValid || !modalState.customLocaleName.trim() || isLoading.update
                    : !isLocaleCodeValid || !modalState.customLocaleName.trim() || isLoading.create
                }
                size="sm"
              >
                {modalState.isEditMode ? 'Update' : 'Add'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
