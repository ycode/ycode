'use client';

/**
 * Page Settings Panel
 *
 * Slide-out panel for creating and editing pages
 */

import React, { useState, useEffect, useMemo, useRef, useImperativeHandle, useCallback } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import type { Page, PageSettings, Asset, FieldVariable } from '@/types';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { usePagesStore } from '@/stores/usePagesStore';
import { useCollectionsStore } from '@/stores/useCollectionsStore';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldSet
} from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import * as SelectPrimitive from '@radix-ui/react-select';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import Icon from '@/components/ui/icon';
import { getPageIcon, isHomepage, buildSlugPath, buildFolderPath, folderHasIndexPage, generateUniqueSlug, generateSlug, sanitizeSlug, isReservedRootSlug } from '@/lib/page-utils';
import { isAssetOfType, ASSET_CATEGORIES } from '@/lib/asset-utils';
import { Textarea } from '@/components/ui/textarea';
import { useAsset } from '@/hooks/use-asset';
import { useEditorStore } from '@/stores/useEditorStore';
import RichTextEditor from './RichTextEditor';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import { getFieldIcon, IMAGE_FIELD_TYPES, RICH_TEXT_FIELD_TYPES } from '@/lib/collection-field-utils';

export interface PageSettingsPanelHandle {
  checkUnsavedChanges: () => Promise<boolean>;
}

interface PageSettingsPanelProps {
  isOpen: boolean;
  page?: Page | null;
  onClose: () => void;
  onSave: (pageData: PageFormData) => Promise<void>;
}

export interface PageFormData {
  name: string;
  slug: string;
  page_folder_id?: string | null;
  is_published?: boolean;
  order?: number;
  depth?: number;
  is_index?: boolean;
  is_dynamic?: boolean;
  error_page?: number | null;
  settings?: PageSettings;
}

// Helper to check if image is a FieldVariable
const isSeoImageFieldVariable = (image: string | FieldVariable | null): image is FieldVariable => {
  return image !== null && typeof image === 'object' && 'type' in image && image.type === 'field';
};

// Helper to compare seoImage values (handles FieldVariable deep comparison)
const compareSeoImage = (
  a: string | FieldVariable | null,
  b: string | FieldVariable | null
): boolean => {
  // Both null or both same string
  if (a === b) return true;

  // One is null, other is not
  if (a === null || b === null) return false;

  // Both are strings
  if (typeof a === 'string' && typeof b === 'string') return a === b;

  // Both are FieldVariables - compare field_id
  if (isSeoImageFieldVariable(a) && isSeoImageFieldVariable(b)) {
    return a.data.field_id === b.data.field_id;
  }

  // Different types
  return false;
};

const PageSettingsPanel = React.forwardRef<PageSettingsPanelHandle, PageSettingsPanelProps>(({
  isOpen,
  onClose,
  page,
  onSave,
}, ref) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [pageFolderId, setPageFolderId] = useState<string | null>(null);
  const [isIndex, setIsIndex] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seoTitle, setSeoTitle] = useState('');
  const [seoDescription, setSeoDescription] = useState('');
  const [seoImage, setSeoImage] = useState<string | FieldVariable | null>(null);
  const [seoNoindex, setSeoNoindex] = useState(false);
  const openFileManager = useEditorStore((state) => state.openFileManager);
  const leftSidebarWidth = useEditorStore((state) => state.leftSidebarWidth);

  const nameInputRef = useRef<HTMLInputElement>(null);

  const [customCodeHead, setCustomCodeHead] = useState('');
  const [customCodeBody, setCustomCodeBody] = useState('');
  const [headVariableSelectKey, setHeadVariableSelectKey] = useState(0);
  const [bodyVariableSelectKey, setBodyVariableSelectKey] = useState(0);
  const customCodeHeadRef = useRef<HTMLTextAreaElement | null>(null);
  const customCodeBodyRef = useRef<HTMLTextAreaElement | null>(null);

  const [authEnabled, setAuthEnabled] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [requireLogin, setRequireLogin] = useState(false);
  const [loginPageId, setLoginPageId] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);

  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [slugFieldId, setSlugFieldId] = useState<string | null>(null);
  // Default item sort for the page's collection. Drives "Next item" /
  // "Previous item" link resolution. `sort_by` is either 'manual' or a field id.
  const [nextPrevSortBy, setNextPrevSortBy] = useState<string>('manual');
  const [nextPrevSortOrder, setNextPrevSortOrder] = useState<'asc' | 'desc'>('asc');

  const { collections, fields } = useCollectionsStore();

  const seoImageId = typeof seoImage === 'string' ? seoImage : null;
  const seoImageAsset = useAsset(seoImageId);

  const hasImage = seoImage !== null || seoImageAsset !== null;
  const hasSelectedAsset = seoImageAsset !== null && !isSeoImageFieldVariable(seoImage);

  const [currentPage, setCurrentPage] = useState<Page | null | undefined>(page);

  // Initialize active tab from URL or default to general
  const [activeTab, setActiveTab] = useState<'general' | 'seo' | 'custom-code'>(() => {
    const editParam = searchParams?.get('edit');
    if (['seo', 'custom-code', 'general'].includes(editParam || '')) {
      return editParam as 'general' | 'seo' | 'custom-code';
    }
    return 'general';
  });

  // Update URL when panel opens or activeTab changes
  useEffect(() => {
    // Reset URL ref when panel closes (so URL can be updated when panel opens again)
    if (!isOpen || !currentPage?.id) {
      lastUrlRef.current = null;
      return;
    }

    // If the panel was opened or activeTab changed, build the target URL
    const params = new URLSearchParams(searchParams?.toString() || '');
    params.set('edit', activeTab || 'general');
    const query = params.toString();
    const targetUrl = `${pathname}${query ? `?${query}` : ''}`;

    // Only navigate if URL is actually different from what we last set
    if (lastUrlRef.current !== targetUrl) {
      lastUrlRef.current = targetUrl;
      router.replace(targetUrl);
    }
  }, [isOpen, activeTab, currentPage?.id, router, pathname, searchParams]);

  // Handle tab changes - update local state
  // URL is updated by the effect below when activeTab changes
  const handleTabChange = useCallback((value: string) => {
    const newTab = value as 'general' | 'seo' | 'custom-code';
    setActiveTab(newTab);
  }, []);

  const [saveCounter, setSaveCounter] = useState(0);
  const [showUnsavedDialog, setShowUnsavedDialog] = useState(false);
  const [pendingAction, setPendingAction] = useState<'close' | 'navigate' | 'external' | null>(null);

  const [pendingPageChange, setPendingPageChange] = useState<Page | null | undefined>(null);
  const rejectedPageRef = useRef<Page | null | undefined>(null);
  const confirmationResolverRef = useRef<((value: boolean) => void) | null>(null);
  const skipNextInitializationRef = useRef(false);
  const lastUrlRef = useRef<string | null>(null);
  const initialValuesRef = useRef<{
    name: string;
    slug: string;
    pageFolderId: string | null;
    isIndex: boolean;
    seoTitle: string;
    seoDescription: string;
    seoImage: string | FieldVariable | null;
    seoNoindex: boolean;
    customCodeHead: string;
    customCodeBody: string;
    authEnabled: boolean;
    authPassword: string;
    requireLogin: boolean;
    loginPageId: string | null;
    collectionId: string | null;
    slugFieldId: string | null;
    nextPrevSortBy: string;
    nextPrevSortOrder: 'asc' | 'desc';
  } | null>(null);

  // Initialize initial values for a blank state
  useEffect(() => {
    if (!initialValuesRef.current) {
      initialValuesRef.current = {
        name: '',
        slug: '',
        pageFolderId: null,
        isIndex: false,
        seoTitle: '',
        seoDescription: '',
        seoImage: null,
        seoNoindex: false,
        customCodeHead: '',
        customCodeBody: '',
        authEnabled: false,
        authPassword: '',
        requireLogin: false,
        loginPageId: null,
        collectionId: null,
        slugFieldId: null,
        nextPrevSortBy: 'manual',
        nextPrevSortOrder: 'asc',
      };
    }
  }, []);

  const pages = usePagesStore((state) => state.pages);
  const folders = usePagesStore((state) => state.folders);

  const isErrorPage = useMemo(() => currentPage?.error_page !== null, [currentPage]);
  const isDynamicPage = useMemo(() => currentPage?.is_dynamic === true, [currentPage]);

  // Get collection fields for variable insertion
  const collectionFields = useMemo(() => {
    if (!isDynamicPage) return [];
    const activeCollectionId = collectionId || currentPage?.settings?.cms?.collection_id || '';
    return fields[activeCollectionId] || [];
  }, [isDynamicPage, collectionId, currentPage?.settings?.cms?.collection_id, fields]);

  // Get available field variables for the selected collection
  const customCodeVariables = useMemo(() => {
    return collectionFields.map(field => `{{${field.name}}}`).join(', ');
  }, [collectionFields]);

  // Helper function to insert text at cursor position in textarea
  const insertTextAtCursor = useCallback((textarea: HTMLTextAreaElement | null, text: string, setValue: (value: string) => void, currentValue: string) => {
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);

    setValue(newValue);

    // Set cursor position after inserted text
    setTimeout(() => {
      const newCursorPos = start + text.length;
      textarea.setSelectionRange(newCursorPos, newCursorPos);
      textarea.focus();
    }, 0);
  }, []);

  // Handle field variable insertion
  const handleFieldVariableInsert = useCallback((fieldName: string, textareaRef: React.RefObject<HTMLTextAreaElement | null>, setValue: (value: string) => void, currentValue: string) => {
    const variableText = `{{${fieldName}}}`;
    insertTextAtCursor(textareaRef.current, variableText, setValue, currentValue);
  }, [insertTextAtCursor]);

  // Reusable field variable select component
  const renderCustomCodeFieldSelector = useCallback(({
    textareaRef,
    value,
    setValue,
    selectKey,
    setSelectKey,
  }: {
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    value: string;
    setValue: (value: string) => void;
    selectKey: number;
    setSelectKey: (updater: (prev: number) => number) => void;
  }) => {
    if (!isDynamicPage || collectionFields.length === 0) return null;

    return (
      <Select
        key={selectKey}
        onValueChange={(fieldName) => {
          handleFieldVariableInsert(fieldName, textareaRef, setValue, value);
          setSelectKey(prev => prev + 1);
        }}
      >
        <SelectPrimitive.Trigger asChild>
          <Button
            variant="secondary"
            size="sm"
            className="h-6 w-6 p-0"
          >
            <Icon name="database" className="size-2.5" />
          </Button>
        </SelectPrimitive.Trigger>
        <SelectContent>
          {collectionFields.map((field) => (
            <SelectItem key={field.id} value={field.name}>
              {field.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }, [isDynamicPage, collectionFields, handleFieldVariableInsert]);

  // Check if there's a URL conflict warning: dynamic page + non-index pages in same folder
  const urlConflictWarning = useMemo(() => {
    if (!currentPage) return null;

    const targetFolderId = pageFolderId !== undefined ? pageFolderId : currentPage.page_folder_id;
    const currentPageIsPublished = currentPage?.is_published || false;

    // Check if there are non-index pages in this folder
    const hasNonIndexPages = pages.some(
      (p) =>
        p.page_folder_id === targetFolderId &&
        !p.is_index &&
        !p.is_dynamic &&
        !p.error_page &&
        p.is_published === currentPageIsPublished &&
        p.id !== currentPage?.id
    );

    if (isDynamicPage && hasNonIndexPages) {
      return 'The parent folder contains regular pages with custom slugs which could conflict with CMS slugs (regular pages would be displayed in priority).';
    }

    return null;
  }, [currentPage, pageFolderId, pages, isDynamicPage]);

  const cmsSiblingWarning = useMemo(() => {
    if (!isDynamicPage || !currentPage) return null;

    const targetFolderId = pageFolderId !== undefined ? pageFolderId : currentPage.page_folder_id;
    const hasSibling = pages.some(
      (p) =>
        p.id !== currentPage.id &&
        p.is_dynamic &&
        p.page_folder_id === targetFolderId &&
        p.is_published === (currentPage.is_published || false)
    );

    return hasSibling
      ? 'Multiple CMS pages are present in this folder, this could cause URL conflicts if CMS items are using the same slugs or ids.'
      : null;
  }, [currentPage, pageFolderId, pages, isDynamicPage]);

  const hasUnsavedChanges = useMemo(() => {
    if (!initialValuesRef.current) return false;

    const initial = initialValuesRef.current;

    const hasChanges = (
      name !== initial.name ||
      slug !== initial.slug ||
      pageFolderId !== initial.pageFolderId ||
      isIndex !== initial.isIndex ||
      seoTitle !== initial.seoTitle ||
      seoDescription !== initial.seoDescription ||
      !compareSeoImage(seoImage, initial.seoImage) ||
      seoNoindex !== initial.seoNoindex ||
      customCodeHead !== initial.customCodeHead ||
      customCodeBody !== initial.customCodeBody ||
      authEnabled !== initial.authEnabled ||
      authPassword !== initial.authPassword ||
      requireLogin !== initial.requireLogin ||
      (loginPageId || null) !== (initial.loginPageId || null) ||
      collectionId !== initial.collectionId ||
      slugFieldId !== initial.slugFieldId ||
      nextPrevSortBy !== initial.nextPrevSortBy ||
      nextPrevSortOrder !== initial.nextPrevSortOrder
    );

    // Clear rejected page when user makes changes (allows them to try navigating again)
    if (hasChanges && rejectedPageRef.current !== null) {
      rejectedPageRef.current = null;
    }

    return hasChanges;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, slug, pageFolderId, isIndex, seoTitle, seoDescription, seoImage, seoNoindex, customCodeHead, customCodeBody, authEnabled, authPassword, requireLogin, loginPageId, collectionId, slugFieldId, nextPrevSortBy, nextPrevSortOrder, saveCounter]);

  // Expose method to check for unsaved changes externally
  useImperativeHandle(ref, () => ({
    checkUnsavedChanges: async () => {
      // If currently saving, allow the change (save is in progress)
      if (isSaving) {
        return true;
      }

      // If no unsaved changes, allow immediately
      if (!hasUnsavedChanges) {
        return true;
      }

      // Show dialog and wait for user decision
      return new Promise<boolean>((resolve) => {
        confirmationResolverRef.current = resolve;
        setPendingAction('external');
        setShowUnsavedDialog(true);
      });
    }
  }), [hasUnsavedChanges, isSaving]);

  // Track the previous page ID to detect actual page changes (not reference changes)
  const prevPageIdRef = useRef<string | null | undefined>(page?.id);

  // Intercept incoming page prop changes
  // Only runs when page ID changes, not on every form field change
  useEffect(() => {
    const pageId = page?.id;
    const currentPageId = currentPage?.id;

    // If the page ID hasn't changed, nothing to do
    // This prevents the effect from running on every form field change
    if (pageId === prevPageIdRef.current && pageId === currentPageId) {
      return;
    }

    // Update the ref if page ID changed
    if (pageId !== prevPageIdRef.current) {
      prevPageIdRef.current = pageId;
    }

    // If the incoming page is the same as current, nothing to do
    if (pageId === currentPageId) {
      return;
    }

    // Don't intercept while saving (the page prop might update with fresh data from the server)
    if (isSaving) {
      return;
    }

    // If this page change was already rejected, ignore it
    if (page === rejectedPageRef.current) {
      return;
    }

    // If we just saved and getting updated data for the SAME page, accept and sync initial values
    // But if switching to a DIFFERENT page, clear the flag and continue to normal flow
    if (skipNextInitializationRef.current) {
      // Check if this is the same page (updated after save) or a different page
      if (pageId === currentPageId || (page && currentPage && page.id === currentPage.id)) {
        setCurrentPage(page);
        rejectedPageRef.current = null;
        // Sync initial values from the updated page to ensure they match what was saved
        if (page && initialValuesRef.current) {
          const settings = page.settings as PageSettings | undefined;
          const isPageErrorPage = page.error_page !== null;
          const isPageDynamic = page.is_dynamic === true;
          const isPageIndex = isPageDynamic ? false : page.is_index;

          initialValuesRef.current.name = page.name;
          initialValuesRef.current.slug = isPageErrorPage || isPageIndex ? '' : (isPageDynamic ? '*' : page.slug || '');
          initialValuesRef.current.pageFolderId = page.page_folder_id;
          initialValuesRef.current.isIndex = isPageIndex;
          initialValuesRef.current.seoTitle = settings?.seo?.title || '';
          initialValuesRef.current.seoDescription = settings?.seo?.description || '';
          initialValuesRef.current.seoImage = settings?.seo?.image || null;
          initialValuesRef.current.seoNoindex = isPageErrorPage ? true : (settings?.seo?.noindex || false);
          initialValuesRef.current.customCodeHead = settings?.custom_code?.head || '';
          initialValuesRef.current.customCodeBody = settings?.custom_code?.body || '';
          initialValuesRef.current.authEnabled = settings?.auth?.enabled || false;
          initialValuesRef.current.authPassword = settings?.auth?.password || '';
          initialValuesRef.current.requireLogin = settings?.auth?.require_login || false;
          initialValuesRef.current.loginPageId = settings?.auth?.login_page_id || null;
          initialValuesRef.current.collectionId = settings?.cms?.collection_id || null;
          initialValuesRef.current.slugFieldId = settings?.cms?.slug_field_id || null;
          {
            const initialIdFieldId = fields[settings?.cms?.collection_id || '']?.find(f => f.key === 'id')?.id;
            initialValuesRef.current.nextPrevSortBy = settings?.cms?.next_previous?.sort_by || initialIdFieldId || 'manual';
            initialValuesRef.current.nextPrevSortOrder = settings?.cms?.next_previous?.sort_order || 'asc';
          }
        }
        return;
      } else {
        // Switching to a different page - clear the skip flag so initialization runs
        skipNextInitializationRef.current = false;
      }
    }

    // Check hasUnsavedChanges by comparing current form state with initialValuesRef
    // We need to do this check HERE, not rely on the useMemo, because the useMemo
    // might not have updated yet due to React batching
    const currentHasChanges = initialValuesRef.current !== null && (
      name !== initialValuesRef.current.name ||
      slug !== initialValuesRef.current.slug ||
      pageFolderId !== initialValuesRef.current.pageFolderId ||
      isIndex !== initialValuesRef.current.isIndex ||
      seoTitle !== initialValuesRef.current.seoTitle ||
      seoDescription !== initialValuesRef.current.seoDescription ||
      !compareSeoImage(seoImage, initialValuesRef.current.seoImage) ||
      seoNoindex !== initialValuesRef.current.seoNoindex ||
      customCodeHead !== initialValuesRef.current.customCodeHead ||
      customCodeBody !== initialValuesRef.current.customCodeBody ||
      authEnabled !== initialValuesRef.current.authEnabled ||
      authPassword !== initialValuesRef.current.authPassword ||
      collectionId !== initialValuesRef.current.collectionId ||
      slugFieldId !== initialValuesRef.current.slugFieldId ||
      nextPrevSortBy !== initialValuesRef.current.nextPrevSortBy ||
      nextPrevSortOrder !== initialValuesRef.current.nextPrevSortOrder
    );

    // If we have unsaved changes, show confirmation dialog BEFORE changing
    if (currentHasChanges) {
      setPendingPageChange(page);
      setPendingAction('navigate');
      setShowUnsavedDialog(true);
      return;
    }

    // No unsaved changes, safe to change
    setCurrentPage(page);
    rejectedPageRef.current = null; // Clear rejected page since we're accepting a change

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id, currentPage?.id, isSaving]);

  // Initialize form when currentPage changes (after confirmation or when no unsaved changes)
  useEffect(() => {
    // Skip initialization if we just saved (to prevent overwriting with stale data from parent)
    if (skipNextInitializationRef.current) {
      skipNextInitializationRef.current = false;
      return;
    }

    if (currentPage) {
      const settings = currentPage.settings as PageSettings | undefined;
      const initialName = currentPage.name;
      const initialIsIndex = currentPage.is_dynamic ? false : currentPage.is_index;
      const initialSlug = isErrorPage || initialIsIndex ? '' : (currentPage.is_dynamic ? '*' : currentPage.slug || '');
      const initialFolderId = currentPage.page_folder_id;
      const initialSeoTitle = settings?.seo?.title || '';
      const initialSeoDescription = settings?.seo?.description || '';
      const initialSeoImage = settings?.seo?.image || null; // Asset ID or FieldVariable
      const initialSeoNoindex = isErrorPage ? true : (settings?.seo?.noindex || false);
      const initialCustomCodeHead = settings?.custom_code?.head || '';
      const initialCustomCodeBody = settings?.custom_code?.body || '';
      const initialAuthEnabled = settings?.auth?.enabled || false;
      const initialAuthPassword = settings?.auth?.password || '';
      const initialRequireLogin = settings?.auth?.require_login || false;
      const initialLoginPageId = settings?.auth?.login_page_id || null;
      const initialCollectionId = settings?.cms?.collection_id || null;
      const initialSlugFieldId = settings?.cms?.slug_field_id || null;
      const initialIdFieldId = fields[settings?.cms?.collection_id || '']?.find(f => f.key === 'id')?.id;
      const initialNextPrevSortBy = settings?.cms?.next_previous?.sort_by || initialIdFieldId || 'manual';
      const initialNextPrevSortOrder: 'asc' | 'desc' = settings?.cms?.next_previous?.sort_order || 'asc';

      // IMPORTANT: Save initial values FIRST before updating form state
      // This prevents false "unsaved changes" detection when switching pages
      initialValuesRef.current = {
        name: initialName,
        slug: initialSlug,
        pageFolderId: initialFolderId,
        isIndex: initialIsIndex,
        seoTitle: initialSeoTitle,
        seoDescription: initialSeoDescription,
        seoImage: initialSeoImage,
        seoNoindex: initialSeoNoindex,
        customCodeHead: initialCustomCodeHead,
        customCodeBody: initialCustomCodeBody,
        authEnabled: initialAuthEnabled,
        authPassword: initialAuthPassword,
        requireLogin: initialRequireLogin,
        loginPageId: initialLoginPageId,
        collectionId: initialCollectionId,
        slugFieldId: initialSlugFieldId,
        nextPrevSortBy: initialNextPrevSortBy,
        nextPrevSortOrder: initialNextPrevSortOrder,
      };

      setName(initialName);
      setSlug(initialSlug);
      setPageFolderId(initialFolderId);
      setIsIndex(initialIsIndex);
      setSeoTitle(initialSeoTitle);
      setSeoDescription(initialSeoDescription);
      setSeoImage(initialSeoImage);
      setSeoNoindex(initialSeoNoindex);
      setCustomCodeHead(initialCustomCodeHead);
      setCustomCodeBody(initialCustomCodeBody);
      setAuthEnabled(initialAuthEnabled);
      setAuthPassword(initialAuthPassword);
      setRequireLogin(initialRequireLogin);
      setLoginPageId(initialLoginPageId);
      setCollectionId(initialCollectionId);
      setSlugFieldId(initialSlugFieldId);
      setNextPrevSortBy(initialNextPrevSortBy);
      setNextPrevSortOrder(initialNextPrevSortOrder);
    } else {
      // Reset initial values for new page FIRST
      initialValuesRef.current = {
        name: '',
        slug: '',
        pageFolderId: null,
        isIndex: false,
        seoTitle: '',
        seoDescription: '',
        seoImage: null,
        seoNoindex: false,
        customCodeHead: '',
        customCodeBody: '',
        authEnabled: false,
        authPassword: '',
        requireLogin: false,
        loginPageId: null,
        collectionId: null,
        slugFieldId: null,
        nextPrevSortBy: 'manual',
        nextPrevSortOrder: 'asc',
      };

      setName('');
      setSlug('');
      setPageFolderId(null);
      setIsIndex(false);
      setSeoTitle('');
      setSeoDescription('');
      setSeoImage(null);
      setSeoNoindex(false);
      setCustomCodeHead('');
      setCustomCodeBody('');
      setAuthEnabled(false);
      setAuthPassword('');
      setRequireLogin(false);
      setLoginPageId(null);
      setCollectionId(null);
      setSlugFieldId(null);
      setNextPrevSortBy('manual');
      setNextPrevSortOrder('asc');
    }

    // Clear error state when page changes
    setError(null);

    // Auto-focus and select name input for newly created pages
    if (currentPage?.id.startsWith('temp-page-')) {
      requestAnimationFrame(() => {
        nameInputRef.current?.focus();
        nameInputRef.current?.select();
      });
    }

    // `fields` is intentionally omitted: this effect should re-run only when
    // the page itself changes, not whenever the collections cache mutates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPage, isErrorPage]);

  // Auto-generate slug from name for new pages (only if not index or error page)
  useEffect(() => {
    if (!currentPage && name && !isIndex && !isErrorPage) {
      const uniqueSlug = generateUniqueSlug(name, pages, pageFolderId, false);
      setSlug(uniqueSlug);
    }
  }, [name, currentPage, isIndex, isErrorPage, pageFolderId, pages]);

  // When isIndex, isErrorPage, or isDynamicPage changes, update slug accordingly
  useEffect(() => {
    if (isIndex || isErrorPage) {
      setSlug(''); // Index pages and error pages must have empty slug
    } else if (isDynamicPage) {
      setSlug('*'); // Dynamic pages use '*' as slug placeholder
    } else if (currentPage && !slug && name) {
      // Guard: Only auto-generate slug if form values match the current page
      // This prevents generating a slug from stale form values during page transitions
      const formMatchesCurrentPage = name === currentPage.name &&
        pageFolderId === currentPage.page_folder_id;

      if (formMatchesCurrentPage) {
        // If switching to non-index/non-error/non-dynamic and slug is empty, generate one
        const uniqueSlug = generateUniqueSlug(name, pages, pageFolderId, currentPage.is_published, currentPage.id);
        setSlug(uniqueSlug);
      }
    }
  }, [isIndex, isErrorPage, isDynamicPage, currentPage, name, slug, pageFolderId, pages]);

  // When folder changes for new pages, regenerate slug to avoid duplicates in new folder
  useEffect(() => {
    if (!currentPage && name && slug && !isIndex && !isErrorPage) {
      const uniqueSlug = generateUniqueSlug(name, pages, pageFolderId, false);
      // Only update if it would be different (to avoid unnecessary re-renders)
      if (uniqueSlug !== slug) {
        setSlug(uniqueSlug);
      }
    }
  }, [pageFolderId, pages, name, slug, isIndex, isErrorPage, currentPage]);

  // Build hierarchical folder list for select dropdown
  const folderOptions = useMemo(() => {
    return folders
      .map(folder => ({
        id: folder.id,
        name: folder.name,
        path: buildFolderPath(folder, folders, false) as string,
        depth: folder.depth,
        disabled: isIndex && folderHasIndexPage(folder.id, pages, currentPage?.id), // Disable if this page is index and folder already has an index
      }))
      .sort((a, b) => a.path.localeCompare(b.path));
  }, [folders, pages, currentPage, isIndex]);

  // Check if this is the last index page in root folder
  // If so, disable the switch to prevent removing it
  const isLastRootIndexPage = useMemo(() => {
    if (!currentPage?.is_index || pageFolderId !== null) {
      return false;
    }

    // Count other index pages in root folder
    const otherRootIndexPages = pages.filter(
      (p) =>
        p.id !== currentPage?.id &&
        p.is_index &&
        p.page_folder_id === null
    );

    return otherRootIndexPages.length === 0;
  }, [currentPage, pageFolderId, pages]);

  const isOnRootFolder = useMemo(() => currentPage?.page_folder_id === null, [currentPage]);

  // Build the slug path preview based on current form values
  const slugPathPreview = useMemo(() => {
    // Error pages don't have a path
    if (isErrorPage) {
      return '';
    }

    // Create a temporary page object with current form values
    const tempPage: Partial<Page> = {
      slug: slug,
      page_folder_id: pageFolderId,
      is_index: isIndex,
      is_dynamic: isDynamicPage,
    };

    let slugFieldKey = '';

    if (isDynamicPage) {
      const activeCollectionId = collectionId || currentPage?.settings?.cms?.collection_id || '';
      const activeSlugFieldId = slugFieldId || currentPage?.settings?.cms?.slug_field_id || '';
      const collectionFields = fields[activeCollectionId] || [];
      const selectedSlugField = collectionFields.find(field => field.id === activeSlugFieldId);

      slugFieldKey = `{${selectedSlugField?.key}}`;
    }

    const basePath = buildSlugPath(tempPage as Page, folders, 'page', slugFieldKey);

    return basePath;
  }, [pageFolderId, slug, isIndex, folders, isErrorPage, isDynamicPage, collectionId, slugFieldId, currentPage, fields]);

  const handleOpenFileManager = () => {
    openFileManager(
      (asset) => {
        if (!asset.mime_type || !isAssetOfType(asset.mime_type, ASSET_CATEGORIES.IMAGES)) {
          return false;
        }
        setSeoImage(asset.id);
      },
      seoImageId,
      [ASSET_CATEGORIES.IMAGES]
    );
  };

  const handleRemoveImage = () => {
    setSeoImage(null);
  };

  // Render Select component for image field variables
  const renderImageFieldSelect = () => {
    if (!isDynamicPage) return null;

    const activeCollectionId = collectionId || currentPage?.settings?.cms?.collection_id || '';
    const activeCollection = collections.find(c => c.id === activeCollectionId);
    const activeCollectionName = activeCollection?.name || 'this collection';
    const collectionFields = fields[activeCollectionId] || [];
    const imageFields = collectionFields.filter(field => IMAGE_FIELD_TYPES.includes(field.type));
    const hasImageFields = imageFields.length > 0;

    // Get the selected field name if a field variable is selected
    const selectedField = isSeoImageFieldVariable(seoImage)
      ? imageFields.find(f => f.id === seoImage.data.field_id)
      : null;

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <div>
            <Select
              key={isSeoImageFieldVariable(seoImage) ? (seoImage.data.field_id || 'none') : 'none'}
              value={isSeoImageFieldVariable(seoImage) ? (seoImage.data.field_id || undefined) : undefined}
              onValueChange={(fieldId) => {
                const field = imageFields.find(f => f.id === fieldId);
                setSeoImage({
                  type: 'field',
                  data: {
                    field_id: fieldId,
                    relationships: [],
                    field_type: field?.type || null,
                  },
                });
              }}
              disabled={!hasImageFields}
            >
              <SelectTrigger variant={hasSelectedAsset ? 'overlay' : 'default'} className="w-auto">
                <span className="flex items-center gap-2">
                  <Icon name="database" className="size-3" />
                  {selectedField ? selectedField.name : 'Select field'}
                </span>
              </SelectTrigger>
              <SelectContent>
                {hasImageFields && (
                  <>
                    {imageFields.map((field) => (
                      <SelectItem key={field.id} value={field.id}>
                        <span className="flex items-center gap-2">
                          <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                          {field.name}
                        </span>
                      </SelectItem>
                    ))}
                  </>
                )}
              </SelectContent>
            </Select>
          </div>
        </TooltipTrigger>
        {!hasImageFields && (
          <TooltipContent>
            <p>No image fields available in &quot;{activeCollectionName}&quot;</p>
          </TooltipContent>
        )}
      </Tooltip>
    );
  };

  const handleCollectionChange = (value: string) => {
    setCollectionId(value);
    // Find the slug field for the selected collection
    const collectionFields = fields[value] || [];
    const slugField = collectionFields.find(field => field.key === 'slug');
    if (slugField) {
      setSlugFieldId(slugField.id);
    } else {
      setSlugFieldId(null);
    }
    // Reset default item sort to (id field, ascending) — field IDs from the
    // previous collection won't exist in the new one.
    const idField = collectionFields.find(field => field.key === 'id');
    setNextPrevSortBy(idField?.id || 'manual');
    setNextPrevSortOrder('asc');
  };

  const handleClose = () => {
    if (hasUnsavedChanges) {
      setPendingAction('close');
      setShowUnsavedDialog(true);
    } else {
      onClose();
    }
  };

  const handleConfirmDiscard = () => {
    setShowUnsavedDialog(false);

    if (pendingAction === 'close') {
      // Reset to initial values before closing to ensure clean state on reopen
      if (initialValuesRef.current) {
        setName(initialValuesRef.current.name);
        setSlug(initialValuesRef.current.slug);
        setPageFolderId(initialValuesRef.current.pageFolderId);
        setIsIndex(initialValuesRef.current.isIndex);
        setSeoTitle(initialValuesRef.current.seoTitle);
        setSeoDescription(initialValuesRef.current.seoDescription);
        setSeoImage(initialValuesRef.current.seoImage);
        setSeoNoindex(initialValuesRef.current.seoNoindex);
        setCustomCodeHead(initialValuesRef.current.customCodeHead);
        setCustomCodeBody(initialValuesRef.current.customCodeBody);
        setAuthEnabled(initialValuesRef.current.authEnabled);
        setAuthPassword(initialValuesRef.current.authPassword);
        setRequireLogin(initialValuesRef.current.requireLogin);
        setLoginPageId(initialValuesRef.current.loginPageId);
        setCollectionId(initialValuesRef.current.collectionId);
        setSlugFieldId(initialValuesRef.current.slugFieldId);
        setNextPrevSortBy(initialValuesRef.current.nextPrevSortBy);
        setNextPrevSortOrder(initialValuesRef.current.nextPrevSortOrder);
      }

      rejectedPageRef.current = null;
      onClose();
    } else if (pendingAction === 'navigate' && pendingPageChange !== undefined) {
      // Discard changes and proceed to load the new page
      setCurrentPage(pendingPageChange);
      setPendingPageChange(null);
      rejectedPageRef.current = null; // Clear rejected since we're accepting the change
    } else if (pendingAction === 'external' && confirmationResolverRef.current) {
      // External check - user confirmed to discard
      // Reset to initial values to clear unsaved changes flag
      if (initialValuesRef.current) {
        setName(initialValuesRef.current.name);
        setSlug(initialValuesRef.current.slug);
        setPageFolderId(initialValuesRef.current.pageFolderId);
        setIsIndex(initialValuesRef.current.isIndex);
        setSeoTitle(initialValuesRef.current.seoTitle);
        setSeoDescription(initialValuesRef.current.seoDescription);
        setSeoImage(initialValuesRef.current.seoImage);
        setSeoNoindex(initialValuesRef.current.seoNoindex);
        setCustomCodeHead(initialValuesRef.current.customCodeHead);
        setCustomCodeBody(initialValuesRef.current.customCodeBody);
        setAuthEnabled(initialValuesRef.current.authEnabled);
        setAuthPassword(initialValuesRef.current.authPassword);
        setRequireLogin(initialValuesRef.current.requireLogin);
        setLoginPageId(initialValuesRef.current.loginPageId);
        setCollectionId(initialValuesRef.current.collectionId);
        setSlugFieldId(initialValuesRef.current.slugFieldId);
        setNextPrevSortBy(initialValuesRef.current.nextPrevSortBy);
        setNextPrevSortOrder(initialValuesRef.current.nextPrevSortOrder);
      }

      rejectedPageRef.current = null;
      confirmationResolverRef.current(true);
      confirmationResolverRef.current = null;
    }

    setPendingAction(null);
  };

  // Handle canceling discard - stay on current page with unsaved changes
  const handleCancelDiscard = () => {
    setShowUnsavedDialog(false);

    if (pendingAction === 'navigate') {
      // Mark this page change as rejected so we don't show the dialog again
      rejectedPageRef.current = pendingPageChange;
      setPendingPageChange(null);
    } else if (pendingAction === 'external' && confirmationResolverRef.current) {
      // External check - user canceled
      confirmationResolverRef.current(false);
      confirmationResolverRef.current = null;
    }

    setPendingAction(null);
    // Don't change currentPage - stay on the current page with unsaved changes
  };

  // Handle saving changes from the unsaved changes dialog
  const handleSaveFromDialog = async () => {
    setShowUnsavedDialog(false);

    // Save changes first
    await handleSave();

    // After save, proceed with the pending action
    if (pendingAction === 'close') {
      onClose();
    } else if (pendingAction === 'navigate' && pendingPageChange !== undefined) {
      // Proceed to load the new page
      setCurrentPage(pendingPageChange);
      setPendingPageChange(null);
      rejectedPageRef.current = null;
    } else if (pendingAction === 'external' && confirmationResolverRef.current) {
      // External check - resolve with true (changes saved)
      confirmationResolverRef.current(true);
      confirmationResolverRef.current = null;
    }

    setPendingAction(null);
  };

  const handleSave = async () => {
    // Validation
    if (!name.trim()) {
      setError('Page name is required');
      return;
    }

    // Error pages have different rules
    if (isErrorPage) {
      // Error pages must have empty slug and no parent folder
      // These are enforced by the UI, but we validate here too
      if (slug.trim()) {
        setError('Error pages must have an empty slug');
        return;
      }
      // Note: We allow saving even if parent folder is set, backend should handle this
    } else if (isDynamicPage && isIndex) {
      // Dynamic pages cannot be set as index
      setError(`CMS pages cannot be set as ${isOnRootFolder ? 'homepage' : 'index page'}`);
      return;
    } else if (isIndex) {
      // Index page rules
      // Index pages must have empty slug
      if (slug.trim()) {
        setError('Index pages must have an empty slug');
        return;
      }

      // Note: We don't check for existing index pages anymore
      // The backend will automatically transfer the index status
    } else {
      // Non-index pages must have a non-empty slug
      if (!slug.trim()) {
        setError('Slug is required for non-index pages');
        return;
      }

      // Check if this is the only index page in root folder (pageFolderId === null)
      // Root folder must always have an index page
      if (currentPage?.is_index && pageFolderId === null) {
        const otherRootIndexPages = pages.filter(
          (p) =>
            p.id !== currentPage?.id &&
            p.is_index &&
            p.page_folder_id === null
        );

        if (otherRootIndexPages.length === 0) {
          setError('The root folder must have an index page. Please set another page as index first.');
          return;
        }
      }

      // Check for duplicate slug within the same folder and published state
      // The database has a unique constraint on (slug, is_published, page_folder_id)
      // Skip slug validation for dynamic pages (they use "*" as slug placeholder)
      if (!isDynamicPage) {
        // Sanitize slug (remove trailing dashes) for comparison
        const trimmedSlug = sanitizeSlug(slug.trim(), false);

        // Check for reserved slugs at root level
        if (pageFolderId === null && isReservedRootSlug(trimmedSlug)) {
          setError(`Slug "${trimmedSlug}" cannot be used inside the root folder.`);
          return;
        }

        const duplicateSlug = pages.find(
          (p) =>
            p.id !== currentPage?.id && // Exclude current page
            p.slug === trimmedSlug &&
            p.is_published === (currentPage?.is_published || false) && // Same published state
            p.page_folder_id === pageFolderId // Same folder (including null for root)
        );

        if (duplicateSlug) {
          setError('This slug is already used by another page in this folder');
          return;
        }
      }

      // Check if trying to make a page dynamic or move a dynamic page to a folder that already has one
    }

    setIsSaving(true);
    setError(null);

    try {
      const existingSettings = currentPage?.settings as PageSettings | undefined;

      const settings: PageSettings = {
        ...existingSettings,
        auth: {
          enabled: authEnabled,
          password: authPassword.trim(),
          require_login: requireLogin,
          login_page_id: loginPageId,
        },
        seo: {
          title: seoTitle.trim(),
          description: seoDescription.trim(),
          image: isErrorPage ? null : seoImage,
          noindex: isErrorPage ? true : seoNoindex,
        },
        custom_code: {
          head: customCodeHead.trim(),
          body: customCodeBody.trim(),
        },
        // Explicitly set or clear cms property
        cms: collectionId && slugFieldId ? {
          collection_id: collectionId,
          slug_field_id: slugFieldId,
          next_previous: {
            sort_by: nextPrevSortBy,
            sort_order: nextPrevSortOrder,
          },
        } : undefined,
      };

      // Sanitize slug and remove trailing dashes before saving
      const finalSlug = isErrorPage || isIndex ? '' : (isDynamicPage ? '*' : sanitizeSlug(slug.trim(), false));

      await onSave({
        name: name.trim(),
        slug: finalSlug,
        page_folder_id: pageFolderId,
        is_index: isIndex,
        is_published: false,
        settings,
      });

      const trimmedName = name.trim();
      const trimmedSlug = isErrorPage || isIndex ? '' : (isDynamicPage ? '*' : sanitizeSlug(slug.trim(), false));
      const trimmedSeoTitle = seoTitle.trim();
      const trimmedSeoDescription = seoDescription.trim();
      const normalizedSeoNoindex = isErrorPage ? true : seoNoindex;
      const trimmedCustomCodeHead = customCodeHead.trim();
      const trimmedCustomCodeBody = customCodeBody.trim();
      const trimmedAuthPassword = authPassword.trim();

      setName(trimmedName);
      setSlug(trimmedSlug);
      setSeoTitle(trimmedSeoTitle);
      setSeoDescription(trimmedSeoDescription);
      setSeoNoindex(normalizedSeoNoindex);
      const normalizedSeoImage = isErrorPage ? null : seoImage;
      setSeoImage(normalizedSeoImage);
      setCustomCodeHead(trimmedCustomCodeHead);
      setCustomCodeBody(trimmedCustomCodeBody);
      setAuthPassword(trimmedAuthPassword);
      setRequireLogin(requireLogin);
      setLoginPageId(loginPageId);

      // Update collection values - normalize to null if either is missing
      const savedCollectionId = collectionId && slugFieldId ? collectionId : null;
      const savedSlugFieldId = collectionId && slugFieldId ? slugFieldId : null;
      setCollectionId(savedCollectionId);
      setSlugFieldId(savedSlugFieldId);
      // Reset next/prev defaults when CMS settings are cleared.
      const savedNextPrevSortBy = savedCollectionId ? nextPrevSortBy : 'manual';
      const savedNextPrevSortOrder: 'asc' | 'desc' = savedCollectionId ? nextPrevSortOrder : 'asc';
      setNextPrevSortBy(savedNextPrevSortBy);
      setNextPrevSortOrder(savedNextPrevSortOrder);

      initialValuesRef.current = {
        name: trimmedName,
        slug: trimmedSlug,
        pageFolderId,
        isIndex,
        seoTitle: trimmedSeoTitle,
        seoDescription: trimmedSeoDescription,
        seoImage: normalizedSeoImage,
        seoNoindex: normalizedSeoNoindex,
        customCodeHead: trimmedCustomCodeHead,
        customCodeBody: trimmedCustomCodeBody,
        authEnabled,
        authPassword: trimmedAuthPassword,
        requireLogin,
        loginPageId,
        collectionId: savedCollectionId,
        slugFieldId: savedSlugFieldId,
        nextPrevSortBy: savedNextPrevSortBy,
        nextPrevSortOrder: savedNextPrevSortOrder,
      };

      rejectedPageRef.current = null;
      skipNextInitializationRef.current = true;
      setSaveCounter(prev => prev + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save page');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40"
        style={{ left: `${leftSidebarWidth}px` }}
        onClick={handleClose}
      />

      {/* Panel */}
      <div
        className="fixed top-14 bottom-0 w-125 bg-background border-r z-50 flex flex-col"
        style={{ left: `${leftSidebarWidth}px` }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4">
          <div className="flex items-center justify-center gap-1.5">
            <Icon name={currentPage ? getPageIcon(currentPage) : 'page'} className="size-3" />
            <Label>{currentPage ? currentPage.name : 'New Page'}</Label>
          </div>

          <div className="flex items-center gap-2">
            <Button
              onClick={handleClose} size="sm"
              variant="secondary"
            >Close</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button
                    onClick={handleSave}
                    disabled={isSaving || !hasUnsavedChanges}
                    size="sm"
                  >
                    {isSaving && <Spinner />}
                    Save
                  </Button>
                </span>
              </TooltipTrigger>
              {!hasUnsavedChanges && !isSaving && (
                <TooltipContent>
                  <p>Saved</p>
                </TooltipContent>
              )}
            </Tooltip>
          </div>
        </div>

        <hr className="mx-5" />

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onValueChange={handleTabChange}
          className="flex-1 flex flex-col px-5 !py-0 overflow-y-auto"
        >
          <TabsList className="w-full">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="seo">SEO</TabsTrigger>
            <TabsTrigger value="custom-code">Custom code</TabsTrigger>
          </TabsList>

          <hr className="my-2" />

          {/* Content */}
          <div className="flex-1 overflow-y-scroll no-scrollbar pb-5">
            {error && (
              <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded text-red-400 text-sm">
                {error}
              </div>
            )}

            <TabsContent value="general">
              {(urlConflictWarning || cmsSiblingWarning) && (
                <div className="flex flex-col gap-2 mb-4">
                  {urlConflictWarning && (
                    <Alert variant="warning">
                      <AlertDescription>{urlConflictWarning}</AlertDescription>
                    </Alert>
                  )}
                  {cmsSiblingWarning && (
                    <Alert variant="warning">
                      <AlertDescription>{cmsSiblingWarning}</AlertDescription>
                    </Alert>
                  )}
                </div>
              )}
              <FieldGroup>
                <FieldSet>
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Page name</FieldLabel>
                      <Input
                        ref={nameInputRef}
                        type="text"
                        value={name}
                        onChange={(e) => {
                          const newName = e.target.value;
                          setName(newName);

                          // Auto-generate slug from name for non-index, non-error, non-dynamic pages
                          // Only if user hasn't manually edited the slug (slug matches generated version)
                          if (!isIndex && !isErrorPage && !isDynamicPage && newName) {
                            // Check if current slug appears to be auto-generated (matches sanitized version of name)
                            const expectedSlug = generateSlug(name);
                            const isSlugAutoGenerated = slug === expectedSlug || slug === '';

                            if (isSlugAutoGenerated) {
                              const newSlug = generateSlug(newName);
                              setSlug(newSlug);
                            }
                          }
                        }}
                        placeholder="Homepage"
                      />
                    </Field>

                    {isDynamicPage && (
                      <Field>
                        <div className="flex items-center gap-2">
                          <div className="w-full space-y-2">
                            <FieldLabel>Collection</FieldLabel>
                            <Select
                              value={collectionId || currentPage?.settings?.cms?.collection_id || ''}
                              onValueChange={handleCollectionChange}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>

                              <SelectContent>
                                {collections.length > 0 ? (
                                  collections.map((collection) => (
                                    <SelectItem key={collection.id} value={collection.id}>
                                      {collection.name}
                                    </SelectItem>
                                  ))
                                ) : (
                                  <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                    No collections available
                                  </div>
                                )}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="w-full space-y-2">
                            <FieldLabel>Slug field</FieldLabel>
                            <Select
                              value={slugFieldId || currentPage?.settings?.cms?.slug_field_id || ''}
                              onValueChange={setSlugFieldId}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>

                              <SelectContent>
                                {(() => {
                                  const activeCollectionId = collectionId || currentPage?.settings?.cms?.collection_id || '';
                                  const collectionFields = fields[activeCollectionId] || [];
                                  const availableFields = collectionFields.filter(field => field.key === 'id' || field.key === 'slug');

                                  if (availableFields.length > 0) {
                                    return availableFields.map((field) => (
                                      <SelectItem key={field.id} value={field.id}>
                                        <span className="flex items-center gap-2">
                                          <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                          {field.name}
                                        </span>
                                      </SelectItem>
                                    ));
                                  }

                                  return (
                                    <div className="px-2 py-1.5 text-sm text-muted-foreground">
                                      No slug fields available
                                    </div>
                                  );
                                })()}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <FieldDescription>
                          {slugPathPreview}
                        </FieldDescription>
                      </Field>
                    )}

                    {isDynamicPage && (collectionId || currentPage?.settings?.cms?.collection_id) && (
                      <Field>
                        <div className="flex items-center gap-2">
                          <div className="w-full space-y-2">
                            <FieldLabel>Default item sort</FieldLabel>
                            <Select
                              value={nextPrevSortBy}
                              onValueChange={(value) => {
                                setNextPrevSortBy(value);
                                if (value === 'manual') {
                                  setNextPrevSortOrder('asc');
                                }
                              }}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>

                              <SelectContent>
                                <SelectGroup>
                                  <SelectItem value="manual">Manual order</SelectItem>
                                </SelectGroup>
                                {(() => {
                                  const activeCollectionId = collectionId || currentPage?.settings?.cms?.collection_id || '';
                                  const allFields = fields[activeCollectionId] || [];
                                  if (allFields.length === 0) return null;
                                  return (
                                    <SelectGroup>
                                      {allFields.map((field) => (
                                        <SelectItem key={field.id} value={field.id}>
                                          <span className="flex items-center gap-2">
                                            <Icon name={getFieldIcon(field.type)} className="size-3 text-muted-foreground shrink-0" />
                                            {field.name}
                                          </span>
                                        </SelectItem>
                                      ))}
                                    </SelectGroup>
                                  );
                                })()}
                              </SelectContent>
                            </Select>
                          </div>

                          <div className="w-full space-y-2">
                            <FieldLabel>Sort order</FieldLabel>
                            <Select
                              value={nextPrevSortOrder}
                              onValueChange={(value) => setNextPrevSortOrder(value as 'asc' | 'desc')}
                              disabled={nextPrevSortBy === 'manual'}
                            >
                              <SelectTrigger className="w-full">
                                <SelectValue placeholder="Select..." />
                              </SelectTrigger>

                              <SelectContent>
                                <SelectItem value="asc">Ascending</SelectItem>
                                <SelectItem value="desc">Descending</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        <FieldDescription>
                          Used for &quot;Next item&quot; / &quot;Previous item&quot; links.
                        </FieldDescription>
                      </Field>
                    )}

                    {!isDynamicPage && (
                      <Field>
                        <div className="flex items-center gap-3">
                          <FieldLabel>Slug</FieldLabel>

                          {/*{isErrorPage && (*/}
                          {/*  <FieldDescription>*/}
                          {/*    Error pages do not have a slug*/}
                          {/*  </FieldDescription>*/}
                          {/*)}*/}

                          {/*{isIndex && (*/}
                          {/*  <FieldDescription>*/}
                          {/*    {isOnRootFolder ? 'Homepages' : 'Index pages'} do not have a slug*/}
                          {/*  </FieldDescription>*/}
                          {/*)}*/}
                        </div>

                        <Input
                          type="text"
                          value={slug}
                          disabled={isIndex || isErrorPage}
                          onChange={(e) => {
                            // Prevent slug changes for error pages and index pages
                            if (!isErrorPage && !isIndex) {
                              const sanitized = sanitizeSlug(e.target.value, true); // Allow trailing dash during input
                              setSlug(sanitized);
                            }
                          }}
                          onBlur={(e) => {
                            // Remove trailing dashes on blur
                            if (!isErrorPage && !isIndex) {
                              const sanitized = sanitizeSlug(e.target.value, false); // Remove trailing dashes
                              setSlug(sanitized);
                            }
                          }}
                          placeholder={
                            isErrorPage
                              ? 'None'
                              : isIndex
                                ? 'None'
                                : 'Add a slug (displayed in the URL)'
                          }
                        />

                        {!isErrorPage && (
                          <FieldDescription>
                            {slugPathPreview}
                          </FieldDescription>
                        )}
                      </Field>
                    )}

                    <Field>
                      <div className="flex items-center gap-3">
                        <FieldLabel>Parent folder</FieldLabel>
                        {currentPage && isHomepage(currentPage) && !isErrorPage && (
                          <FieldDescription className="text-xs text-muted-foreground">
                            Homepages cannot be moved
                          </FieldDescription>
                        )}
                        {isErrorPage && (
                          <FieldDescription className="text-xs text-muted-foreground">
                            Error pages cannot be moved
                          </FieldDescription>
                        )}
                      </div>

                      <Select
                        value={pageFolderId || 'root'}
                        onValueChange={(value) => setPageFolderId(value === 'root' ? null : value)}
                        disabled={currentPage ? (isHomepage(currentPage) || isErrorPage) : false}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="None" />
                        </SelectTrigger>

                        <SelectContent>
                          <SelectGroup>
                            <SelectItem
                              value="root"
                              disabled={isIndex && folderHasIndexPage(null, pages, currentPage?.id)}
                            >
                              <div className="flex items-center gap-2">
                                <Icon name="folder" className="size-3" />
                                None
                                {isIndex && folderHasIndexPage(null, pages, currentPage?.id) && (
                                  <span>(has a homepage)</span>
                                )}
                              </div>
                            </SelectItem>

                            {folderOptions.map((folder) => (
                              <SelectItem
                                key={folder.id} value={folder.id}
                                disabled={folder.disabled}
                              >
                                <div className="flex items-center gap-2">
                                  <Icon name="folder" className="size-3" />
                                  <span>{folder.path}</span>
                                  {folder.disabled && (
                                    <span>(has a index page)</span>
                                  )}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>

                    <Field orientation="horizontal" className="flex flex-row-reverse!">
                      <FieldContent>
                        <FieldLabel htmlFor="passwordProtected">
                          Password protected
                        </FieldLabel>
                        <FieldDescription>
                          Restrict access to this page. Setting a password will override any password set on a parent folder. Passwords are case-sensitive.
                        </FieldDescription>
                      </FieldContent>
                      <Checkbox
                        id="passwordProtected"
                        checked={authEnabled}
                        onCheckedChange={(checked) => setAuthEnabled(checked === true)}
                        disabled={isErrorPage}
                      />
                    </Field>

                    {authEnabled && (
                      <Field>
                        <FieldLabel>Password</FieldLabel>
                        <div className="flex gap-1.5">
                          <Input
                            type={showPassword ? 'text' : 'password'}
                            value={authPassword}
                            onChange={(e) => setAuthPassword(e.target.value)}
                            placeholder="Enter password"
                          />
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="w-18"
                            onClick={() => setShowPassword(!showPassword)}
                          >
                            {showPassword ? 'Hide' : 'Show'}
                          </Button>
                        </div>
                      </Field>
                    )}

                    <Field orientation="horizontal" className="flex flex-row-reverse!">
                      <FieldContent>
                        <FieldLabel htmlFor="requireLogin">
                          Require login
                        </FieldLabel>
                        <FieldDescription>
                          Only logged in site users can access this page.
                        </FieldDescription>
                      </FieldContent>
                      <Checkbox
                        id="requireLogin"
                        checked={requireLogin}
                        onCheckedChange={(checked) => setRequireLogin(checked === true)}
                        disabled={isErrorPage}
                      />
                    </Field>

                    {requireLogin && (
                      <Field>
                        <FieldLabel>Login redirect page</FieldLabel>
                        <FieldDescription>
                          Page to redirect unauthenticated visitors to.
                        </FieldDescription>
                        <Select
                          value={loginPageId || 'default'}
                          onValueChange={(val) => setLoginPageId(val === 'default' ? null : val)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Global default" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="default">Global default</SelectItem>
                            {pages.filter(p => !p.is_dynamic && !p.error_page && p.id !== currentPage?.id).map((p) => (
                              <SelectItem key={p.id} value={p.id}>
                                {p.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}

                    <Field orientation="horizontal" className="flex flex-row-reverse!">
                      <FieldContent>
                        <FieldLabel htmlFor="homepage">
                          {isOnRootFolder ? 'Homepage' : 'Index page'}
                        </FieldLabel>
                        <FieldDescription>
                          {
                            isErrorPage
                              ? 'Error pages cannot be set as index page.'
                              : isDynamicPage
                                ? `CMS pages cannot be set as ${isOnRootFolder ? 'homepage' : 'index page'}.`
                                : isLastRootIndexPage
                                  ? 'The root folder must have an homepage. Please open the settings of another page at this level and set it as homepage to change this.'
                                  : `Set this page as the ${isOnRootFolder ? 'homepage of the website' : 'index (default) page for its parent folder'}. If another ${isOnRootFolder ? 'homepage' : 'index page'} exists, it will converted to a regular page with a slug.`
                          }
                        </FieldDescription>
                      </FieldContent>

                      <Checkbox
                        id="homepage"
                        checked={isIndex}
                        disabled={isLastRootIndexPage || isErrorPage || isDynamicPage}
                        onCheckedChange={(checked) => setIsIndex(checked === true)}
                      />
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </TabsContent>

            <TabsContent value="seo">
              <FieldGroup>
                <FieldSet>
                  <FieldGroup>
                    <Field>
                      <FieldLabel>Page title</FieldLabel>
                      <FieldDescription>
                        Appears in search results and browser tabs. Page name is used when empty.
                      </FieldDescription>
                      {isDynamicPage ? (
                        <RichTextEditor
                          value={seoTitle}
                          onChange={setSeoTitle}
                          placeholder={name || 'Page title'}
                          allowedFieldTypes={RICH_TEXT_FIELD_TYPES}
                          fieldGroups={(() => {
                            const activeCollectionId = collectionId || currentPage?.settings?.cms?.collection_id || '';
                            const pageFields = fields[activeCollectionId] || [];
                            const collection = collections.find(c => c.id === activeCollectionId);
                            return pageFields.length > 0 ? [{
                              fields: pageFields,
                              label: collection?.name || 'Page collection fields',
                              source: 'page' as const,
                            }] : undefined;
                          })()}
                        />
                      ) : (
                        <Input
                          type="text"
                          value={seoTitle}
                          onChange={(e) => setSeoTitle(e.target.value)}
                          placeholder={name || 'Page title'}
                        />
                      )}
                    </Field>

                    <Field>
                      <FieldLabel>Meta description</FieldLabel>
                      <FieldDescription>
                        Brief description for search engines (generally 150 to 160 characters).
                      </FieldDescription>
                      {isDynamicPage ? (
                        <RichTextEditor
                          value={seoDescription}
                          onChange={setSeoDescription}
                          className="min-h-18"
                          placeholder={
                            isErrorPage
                              ? 'Describe in more detail what error occurred on this page and why.'
                              : 'Describe your business and/or the content of this page.'
                          }
                          allowedFieldTypes={RICH_TEXT_FIELD_TYPES}
                          fieldGroups={(() => {
                            const activeCollectionId = collectionId || currentPage?.settings?.cms?.collection_id || '';
                            const pageFields = fields[activeCollectionId] || [];
                            const collection = collections.find(c => c.id === activeCollectionId);
                            return pageFields.length > 0 ? [{
                              fields: pageFields,
                              label: collection?.name || 'Page collection fields',
                              source: 'page' as const,
                            }] : undefined;
                          })()}
                        />
                      ) : (
                        <Textarea
                          value={seoDescription}
                          onChange={(e) => setSeoDescription(e.target.value)}
                          placeholder={
                            isErrorPage
                              ? 'Describe in more detail what error occurred on this page and why.'
                              : 'Describe your business and/or the content of this page.'
                          }
                        />
                      )}
                    </Field>

                    {!isErrorPage && (
                      <>
                        <Field>
                          <FieldLabel>Social preview</FieldLabel>
                          <FieldDescription>Recommended image size is at least 1,200 x 630 pixels.</FieldDescription>
                          <div>
                            <div className="bg-input rounded-lg w-full aspect-[1.91/1] flex items-center justify-center overflow-hidden relative">
                              {isSeoImageFieldVariable(seoImage) ? null : (() => {
                                const imageUrl = seoImageAsset?.public_url;
                                // `unoptimized`: the assets store already
                                // rewrites `public_url` to our `/a/...` proxy
                                // URL with resize params, so we don't want
                                // Next's optimizer (and its `localPatterns`
                                // gate) to re-process it.
                                return imageUrl ? (
                                  <Image
                                    className="object-cover"
                                    src={imageUrl}
                                    alt="Social preview"
                                    fill
                                    sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                                    unoptimized
                                  />
                                ) : null;
                              })()}

                              {(() => {
                                const hasFieldVariable = isSeoImageFieldVariable(seoImage);

                                return (
                                  <div className="flex items-center gap-2 relative z-10">
                                    {hasSelectedAsset ? (
                                      <Button
                                        variant="overlay"
                                        size="sm"
                                        onClick={handleOpenFileManager}
                                      >
                                        <Icon name="refresh" />
                                        Replace
                                      </Button>
                                    ) : (
                                      <>
                                        {!hasFieldVariable && (
                                          <Button
                                            variant={hasImage ? 'overlay' : 'secondary'}
                                            size="sm"
                                            onClick={handleOpenFileManager}
                                          >
                                            Choose image
                                          </Button>
                                        )}

                                        {isDynamicPage && !hasFieldVariable && !hasSelectedAsset && <span className="text-muted-foreground">or</span>}

                                        {!hasSelectedAsset && renderImageFieldSelect()}
                                      </>
                                    )}

                                    {(hasSelectedAsset || hasFieldVariable) && (
                                      <Button
                                        variant={hasSelectedAsset ? 'overlay' : 'secondary'}
                                        size="sm"
                                        onClick={handleRemoveImage}
                                      >
                                        <Icon name="trash" />
                                        Remove
                                      </Button>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          </div>
                        </Field>

                        <Field orientation="horizontal" className="flex flex-row-reverse!">
                          <FieldContent>
                            <FieldLabel htmlFor="noindex" className="cursor-pointer">
                              Exclude this page from search engine results
                            </FieldLabel>
                            <FieldDescription>
                              Prevent search engines like Google from indexing this page.
                            </FieldDescription>
                          </FieldContent>

                          <Checkbox
                            id="noindex"
                            checked={seoNoindex}
                            onCheckedChange={(checked) => setSeoNoindex(checked === true)}
                          />
                        </Field>
                      </>
                    )}
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </TabsContent>

            <TabsContent value="custom-code">
              <FieldGroup>
                <FieldSet>
                  <FieldGroup>
                    {isDynamicPage && (
                      <Field>
                        <FieldLabel>Dynamic variables</FieldLabel>

                        <FieldDescription className="flex flex-col gap-2.5">
                          <span>
                            The page CMS item values can be added to your custom codes (for example to improve SEO with JSON-LD) by adding
                            field names like <span className="text-foreground">{'{{Name}}'}</span>, which will be replaced with the value
                            of the <span className="text-foreground">Name</span> field on each generated page.
                          </span>
                        </FieldDescription>
                      </Field>
                    )}

                    <Field>
                      <FieldLabel>Header</FieldLabel>
                      <FieldDescription>
                        Add custom code to the &lt;head&gt; section of the page. It can be useful when you want to add custom meta tags, analytics, or custom CSS.
                      </FieldDescription>
                      <div className="relative">
                        <Textarea
                          ref={(el) => { customCodeHeadRef.current = el; }}
                          value={customCodeHead}
                          onChange={(e) => setCustomCodeHead(e.target.value)}
                          placeholder="<script>...</script>"
                          className="min-h-48 w-full"
                        />
                        {isDynamicPage && (
                          <div className="absolute top-1 right-1 pointer-events-none">
                            <div className="pointer-events-auto">
                              {renderCustomCodeFieldSelector({
                                textareaRef: customCodeHeadRef,
                                value: customCodeHead,
                                setValue: setCustomCodeHead,
                                selectKey: headVariableSelectKey,
                                setSelectKey: setHeadVariableSelectKey,
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </Field>

                    <Field>
                      <FieldLabel>Body</FieldLabel>
                      <FieldDescription>
                        Add custom code before the closing &lt;/body&gt; tag. It can be useful when you want to add custom scripts that need to run after the page loads.
                      </FieldDescription>
                      <div className="relative">
                        <Textarea
                          ref={(el) => { customCodeBodyRef.current = el; }}
                          value={customCodeBody}
                          onChange={(e) => setCustomCodeBody(e.target.value)}
                          placeholder="<script>...</script>"
                          className="min-h-48 w-full"
                        />

                        {isDynamicPage && (
                          <div className="absolute top-1 right-1 pointer-events-none">
                            <div className="pointer-events-auto">
                              {renderCustomCodeFieldSelector({
                                textareaRef: customCodeBodyRef,
                                value: customCodeBody,
                                setValue: setCustomCodeBody,
                                selectKey: bodyVariableSelectKey,
                                setSelectKey: setBodyVariableSelectKey,
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </Field>
                  </FieldGroup>
                </FieldSet>
              </FieldGroup>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* Unsaved changes confirmation dialog */}
      <ConfirmDialog
        open={showUnsavedDialog}
        onOpenChange={setShowUnsavedDialog}
        title="Unsaved Changes"
        description="You have unsaved changes. Are you sure you want to discard them?"
        confirmLabel="Discard changes"
        cancelLabel="Cancel"
        confirmVariant="destructive"
        onConfirm={handleConfirmDiscard}
        onCancel={handleCancelDiscard}
        saveLabel="Save changes"
        onSave={handleSaveFromDialog}
      />
    </>
  );
});

PageSettingsPanel.displayName = 'PageSettingsPanel';

export default PageSettingsPanel;
