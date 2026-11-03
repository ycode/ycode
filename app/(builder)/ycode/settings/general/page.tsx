'use client';

import { useState, useCallback, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Field, FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSeparator
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { ButtonGroup } from '@/components/ui/button-group';
import { Button } from '@/components/ui/button';
import { CodeEditor } from '@/components/ui/code-editor';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useSettingsStore } from '@/stores/useSettingsStore';
import { useAssetsStore } from '@/stores/useAssetsStore';
import type { SitemapSettings, SitemapMode, SitemapChangeFrequency, Asset } from '@/types';
import { normalizeSitemapSettings } from '@/lib/sitemap-settings';
import { getTimezoneOptions } from '@/lib/setting-utils';
import { getDetectedTimezone, isCloudVersion } from '@/lib/utils';
import { Icon } from '@/components/ui/icon';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import FileManagerDialog from '../../components/FileManagerDialog';
import { toast } from 'sonner';
import { ASSET_CATEGORIES } from '@/lib/asset-constants';

export default function GeneralSettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('website');
  const { getSettingByKey, saveSettings } = useSettingsStore();

  // Initialize sitemap settings from store
  const [sitemapSettings, setSitemapSettings] = useState<SitemapSettings>(
    () => normalizeSitemapSettings(getSettingByKey('sitemap'))
  );
  const [isSaving, setIsSaving] = useState(false);

  // Initialize robots.txt and llms.txt from store
  const storedRobotsTxt = getSettingByKey('robots_txt') as string | null;
  const storedLlmsTxt = getSettingByKey('llms_txt') as string | null;
  const [robotsTxt, setRobotsTxt] = useState(storedRobotsTxt || '');
  const [llmsTxt, setLlmsTxt] = useState(storedLlmsTxt || '');

  // Initialize Google Analytics, Site Verification, and Canonical URL from store
  const storedGaMeasurementId = getSettingByKey('ga_measurement_id') as string | null;
  const storedGoogleSiteVerification = getSettingByKey('google_site_verification') as string | null;
  const storedGlobalCanonicalUrl = getSettingByKey('global_canonical_url') as string | null;
  const [gaMeasurementId, setGaMeasurementId] = useState(storedGaMeasurementId || '');
  const [googleSiteVerification, setGoogleSiteVerification] = useState(storedGoogleSiteVerification || '');
  const [globalCanonicalUrl, setGlobalCanonicalUrl] = useState(storedGlobalCanonicalUrl || '');

  // Initialize global custom code from store
  const storedCustomCodeHead = getSettingByKey('custom_code_head') as string | null;
  const storedCustomCodeBody = getSettingByKey('custom_code_body') as string | null;
  const [customCodeHead, setCustomCodeHead] = useState(storedCustomCodeHead || '');
  const [customCodeBody, setCustomCodeBody] = useState(storedCustomCodeBody || '');
  const [isSavingCustomCode, setIsSavingCustomCode] = useState(false);

  // Initialize Ycode badge from store
  const storedYcodeBadge = getSettingByKey('ycode_badge') as boolean | null;
  const [ycodeBadge, setYcodeBadge] = useState(storedYcodeBadge ?? true);
  const [isSavingWebsite, setIsSavingWebsite] = useState(false);

  // Initialize timezone from store (default UTC)
  const storedTimezone = getSettingByKey('timezone') as string | null;
  const [timezone, setTimezone] = useState(storedTimezone ?? 'UTC');
  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  // Initialize project (site) name from store.
  const storedSiteName = getSettingByKey('site_name') as string | null;
  const [siteName, setSiteName] = useState(storedSiteName || '');

  // Initialize favicon and web clip from store
  const storedFaviconAssetId = getSettingByKey('favicon_asset_id') as string | null;
  const storedWebClipAssetId = getSettingByKey('web_clip_asset_id') as string | null;
  const [faviconAssetId, setFaviconAssetId] = useState(storedFaviconAssetId || '');
  const [webClipAssetId, setWebClipAssetId] = useState(storedWebClipAssetId || '');

  // File manager dialog state
  const [fileManagerOpen, setFileManagerOpen] = useState(false);
  const [fileManagerMode, setFileManagerMode] = useState<'favicon' | 'webclip'>('favicon');

  // Stable category filter — favicon accepts both raster images and SVG icons.
  // Memoized to avoid creating a new array on every render, which would cause
  // the file manager to reload its asset list in a loop.
  const fileManagerCategory = useMemo(
    () => fileManagerMode === 'favicon'
      ? [ASSET_CATEGORIES.IMAGES, ASSET_CATEGORIES.ICONS]
      : ASSET_CATEGORIES.IMAGES,
    [fileManagerMode],
  );

  // Assets store for getting asset details
  const assetsById = useAssetsStore((state) => state.assetsById);
  const addAssetsToCache = useAssetsStore((state) => state.addAssetsToCache);

  // Fetch assets on mount if not already in cache
  useEffect(() => {
    const idsToFetch = [faviconAssetId, webClipAssetId].filter(
      (id) => id && !assetsById[id]
    );

    if (idsToFetch.length === 0) return;

    // Fetch missing assets
    Promise.all(
      idsToFetch.map((id) =>
        fetch(`/ycode/api/assets/${id}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((result) => result?.data as Asset | null)
          .catch(() => null)
      )
    ).then((fetchedAssets) => {
      const validAssets = fetchedAssets.filter((a): a is Asset => a !== null);
      if (validAssets.length > 0) {
        addAssetsToCache(validAssets);
      }
    });
  }, [faviconAssetId, webClipAssetId, assetsById, addAssetsToCache]);

  // Get asset details for display
  const faviconAsset = faviconAssetId ? assetsById[faviconAssetId] : null;
  const webClipAsset = webClipAssetId ? assetsById[webClipAssetId] : null;

  // Derive activeSeoTab from sitemap mode
  const activeSeoTab = sitemapSettings.mode === 'auto'
    ? 'ycode-sitemap'
    : sitemapSettings.mode === 'custom'
      ? 'custom-sitemap'
      : 'no-sitemap';

  // Update sitemap settings locally
  const updateSitemapSetting = useCallback(<K extends keyof SitemapSettings>(
    key: K,
    value: SitemapSettings[K]
  ) => {
    setSitemapSettings(prev => ({ ...prev, [key]: value }));
  }, []);

  // Handle tab change for sitemap mode
  const handleSitemapTabChange = useCallback((tab: string) => {
    const mode: SitemapMode = tab === 'ycode-sitemap'
      ? 'auto'
      : tab === 'custom-sitemap'
        ? 'custom'
        : 'none';
    updateSitemapSetting('mode', mode);
  }, [updateSitemapSetting]);

  // Save SEO settings
  const saveSeoSettings = useCallback(async () => {
    setIsSaving(true);
    await saveSettings({
      sitemap: sitemapSettings,
      robots_txt: robotsTxt,
      llms_txt: llmsTxt,
      ga_measurement_id: gaMeasurementId,
      google_site_verification: googleSiteVerification,
      global_canonical_url: globalCanonicalUrl,
    });
    setIsSaving(false);
  }, [saveSettings, sitemapSettings, robotsTxt, llmsTxt, gaMeasurementId, googleSiteVerification, globalCanonicalUrl]);

  // Save custom code settings
  const saveCustomCodeSettings = useCallback(async () => {
    setIsSavingCustomCode(true);
    await saveSettings({
      custom_code_head: customCodeHead,
      custom_code_body: customCodeBody,
    });
    setIsSavingCustomCode(false);
  }, [saveSettings, customCodeHead, customCodeBody]);

  // Save website settings
  const saveWebsiteSettings = useCallback(async () => {
    const trimmedName = siteName.trim();
    if (!trimmedName) {
      toast.error('Project name is required');
      return;
    }

    setIsSavingWebsite(true);
    try {
      const success = await saveSettings({
        site_name: trimmedName,
        ycode_badge: ycodeBadge,
        timezone,
        favicon_asset_id: faviconAssetId || null,
        web_clip_asset_id: webClipAssetId || null,
      });

      if (!success) {
        toast.error(useSettingsStore.getState().error || 'Settings could not be saved. Please try again.');
        return;
      }

      toast.success('Settings have been successfully saved');
    } finally {
      setIsSavingWebsite(false);
    }
  }, [siteName, saveSettings, ycodeBadge, timezone, faviconAssetId, webClipAssetId]);

  const handleDetectTimezone = useCallback(() => {
    const detected = getDetectedTimezone();
    if (detected) setTimezone(detected);
  }, []);

  // Open file manager for favicon or web clip selection
  const handleOpenFileManager = useCallback((mode: 'favicon' | 'webclip') => {
    setFileManagerMode(mode);
    setFileManagerOpen(true);
  }, []);

  // Handle asset selection from file manager with size validation
  const handleAssetSelect = useCallback((asset: Asset) => {
    const minSize = fileManagerMode === 'favicon' ? 32 : 256;
    const label = fileManagerMode === 'favicon' ? 'Favicon' : 'Web clip';

    // Validate image type
    if (!asset.mime_type?.startsWith('image/')) {
      toast.error(`${label} must be an image file`);
      return false;
    }

    // SVGs scale without quality loss; skip dimension checks entirely
    const isSvg = asset.mime_type === 'image/svg+xml';

    if (!isSvg) {
      if (!asset.width || !asset.height) {
        toast.error(`Unable to determine image dimensions`);
        return false;
      }

      if (asset.width < minSize || asset.height < minSize) {
        toast.error(`${label} must be at least ${minSize}x${minSize} pixels`, {
          description: `Selected image is ${asset.width}x${asset.height} pixels`,
        });
        return false;
      }
    }

    // Set the asset ID
    if (fileManagerMode === 'favicon') {
      setFaviconAssetId(asset.id);
    } else {
      setWebClipAssetId(asset.id);
    }

    setFileManagerOpen(false);
    return false; // Prevent default file manager behavior
  }, [fileManagerMode]);

  // Remove favicon or web clip
  const handleRemoveAsset = useCallback((mode: 'favicon' | 'webclip') => {
    if (mode === 'favicon') {
      setFaviconAssetId('');
    } else {
      setWebClipAssetId('');
    }
  }, []);

  // Reset project state
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleResetProject = useCallback(async () => {
    try {
      setIsResetting(true);

      const response = await fetch('/ycode/api/devtools/reset-db', {
        method: 'POST',
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || 'Failed to reset project');
      }

      window.location.href = '/ycode';
    } catch (err) {
      console.error('Error resetting project:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to reset project');
      setIsResetting(false);
      setShowResetDialog(false);
    }
  }, []);

  return (
    <div className="p-8">
      <div className="max-w-3xl mx-auto">
        <header className="pt-8 pb-3">
          <span className="text-base font-medium">General settings</span>
        </header>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full">
            <TabsTrigger value="website">Website</TabsTrigger>
            <TabsTrigger value="seo">SEO</TabsTrigger>
            <TabsTrigger value="custom-code">Custom code</TabsTrigger>
          </TabsList>

          <TabsContent value="website" className="mt-2 flex flex-col gap-4">

            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>Main details</FieldLegend>
                <FieldDescription>This information might be displayed publicly so be careful what you share.</FieldDescription>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-5">
                <Field className="col-span-2">
                  <FieldLabel htmlFor="project-name">
                    Project name
                  </FieldLabel>
                  <Input
                    id="project-name"
                    placeholder="My website"
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    required
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex items-center gap-6">
                  <div className="size-28 bg-secondary/20 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                    {faviconAsset?.public_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={faviconAsset.public_url}
                        alt="Favicon preview"
                        className="size-8 object-contain"
                      />
                    ) : faviconAsset?.content ? (
                      <div
                        className="size-8 text-foreground"
                        dangerouslySetInnerHTML={{ __html: faviconAsset.content }}
                      />
                    ) : (
                      <Image
                        src={'/y-filled.svg'}
                        alt="Favicon preview"
                        width={32}
                        height={32}
                        className="size-8"
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <FieldLabel>
                      Favicon
                    </FieldLabel>
                    <FieldDescription>
                      32 x 32 pixels minimum. ICO, PNG, GIF, SVG, or JPG.
                    </FieldDescription>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-fit"
                        onClick={() => handleOpenFileManager('favicon')}
                      >
                        {faviconAssetId ? 'Change' : 'Select'}
                      </Button>
                      {faviconAssetId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-fit"
                          onClick={() => handleRemoveAsset('favicon')}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <div className="col-span-2 flex items-center gap-6">
                  <div className="size-28 bg-secondary/20 rounded-lg flex items-center justify-center shrink-0 overflow-hidden">
                    {webClipAsset?.public_url ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={webClipAsset.public_url}
                        alt="Web clip preview"
                        className="size-16 rounded-[10px] object-cover"
                      />
                    ) : (
                      <Image
                        src={'/ycode-webclip.png'}
                        alt="Web clip preview"
                        width={64}
                        height={64}
                        className="size-16 rounded-[10px]"
                      />
                    )}
                  </div>

                  <div className="flex flex-col gap-2">
                    <FieldLabel>
                      Web clip
                    </FieldLabel>
                    <FieldDescription>
                      256 x 256 pixels minimum. Shown when web URLs are saved to a phone&apos;s home screen or browser bookmarks.
                    </FieldDescription>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        className="w-fit"
                        onClick={() => handleOpenFileManager('webclip')}
                      >
                        {webClipAssetId ? 'Change' : 'Select'}
                      </Button>
                      {webClipAssetId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="w-fit"
                          onClick={() => handleRemoveAsset('webclip')}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  </div>
                </div>

                <FieldSeparator className="col-span-2" />

                <Field className="col-span-2">
                  <FieldLabel htmlFor="timezone">
                    Timezone
                  </FieldLabel>
                  <ButtonGroup className="w-full">
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="secondary"
                      className="shrink-0 rounded-lg"
                      onClick={handleDetectTimezone}
                      aria-label="Detect timezone automatically"
                    >
                      <Icon name="map" className="size-3.5" />
                    </Button>

                    <Separator orientation="vertical" className="self-stretch" />

                    <Select value={timezone || undefined} onValueChange={setTimezone}>
                      <SelectTrigger id="timezone" className="flex-1">
                        <SelectValue placeholder="Select timezone" />
                      </SelectTrigger>
                      <SelectContent>
                        {timezoneOptions.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </ButtonGroup>
                </Field>

                <FieldSeparator className="col-span-2" />

                <Field orientation="horizontal" className="flex-row-reverse col-span-2">
                  <FieldContent>
                    <FieldLabel htmlFor="badge">Display the &ldquo;Made in Ycode&rdquo; badge</FieldLabel>
                    <FieldDescription>
                      {isCloudVersion()
                        ? 'Upgrade to a project plan in order to disable the badge.'
                        : 'Help support Ycode by displaying this badge on your website.'}
                    </FieldDescription>
                  </FieldContent>
                  <Switch
                    id="badge"
                    checked={ycodeBadge}
                    onCheckedChange={setYcodeBadge}
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={saveWebsiteSettings}
                    disabled={isSavingWebsite}
                  >
                    {isSavingWebsite ? 'Saving...' : 'Save changes'}
                  </Button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>Danger zone</FieldLegend>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-5">

                <div className="col-span-2 flex items-center gap-6">

                  <div className="flex flex-col gap-2">
                    <FieldLabel>
                      Reset project
                    </FieldLabel>
                    <FieldDescription>
                      Reset your project to a blank canvas. This will permanently delete all pages, CMS collections, assets, and settings.
                    </FieldDescription>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => setShowResetDialog(true)}
                      >
                        Reset project
                      </Button>
                    </div>
                  </div>
                </div>

              </div>
            </div>

          </TabsContent>

          <TabsContent value="seo" className="mt-2">
            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>SEO settings</FieldLegend>
                <FieldDescription>These are global project SEO settings. You can individually adjust meta titles, descriptions and open graph info per collection item or via page settings.</FieldDescription>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-8">
                <Field className="col-span-2">
                  <FieldLabel htmlFor="google-analytics-measurement-id">
                    Google Analytics Measurement ID
                  </FieldLabel>
                  <FieldDescription>
                    Seamlessly integrate Google Analytics into your Ycode site. As the site owner, you are responsible for ensuring your site complies with privacy regulations, such as GDPR, and handles data appropriately.
                  </FieldDescription>
                  <Input
                    id="google-analytics-measurement-id"
                    value={gaMeasurementId}
                    onChange={(e) => setGaMeasurementId(e.target.value)}
                    placeholder="G-XXXXXXXX"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="google-site-verification">
                    Google Site Verification
                  </FieldLabel>
                  <FieldDescription>
                    Verifying your site with Google will give you access to your website&apos;s private Google Search data. You will also be able to affect how Google Search crawls your site.
                  </FieldDescription>
                  <Input
                    id="google-site-verification"
                    value={googleSiteVerification}
                    onChange={(e) => setGoogleSiteVerification(e.target.value)}
                    placeholder="e.g. x88atPHmzG1G2FBivU1bk-w398zDtl8Mci2AC2tYd4kw"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="global-canonical-url">
                    Global Canonical Tag URL
                  </FieldLabel>
                  <FieldDescription>
                    Set the global URL to use in the canonical tag for this site so search engines know the proper URL to index and don&apos;t serve duplicate content.
                  </FieldDescription>
                  <Input
                    id="global-canonical-url"
                    value={globalCanonicalUrl}
                    onChange={(e) => setGlobalCanonicalUrl(e.target.value)}
                    placeholder="https://"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="robots">
                    Contents of &ldquo;robots.txt&rdquo;
                  </FieldLabel>
                  <FieldDescription>
                    If populated, will replace the content of the default /robots.txt file. Learn more about this file at robotstxt.org.
                  </FieldDescription>
                  <Textarea
                    id="robots"
                    value={robotsTxt}
                    onChange={(e) => setRobotsTxt(e.target.value)}
                    placeholder={'User-agent: *\nAllow: /\nDisallow: /ycode/'}
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="llms">
                    Contents of &ldquo;llms.txt&rdquo;
                  </FieldLabel>
                  <FieldDescription>
                    If populated, this content will be served at /llms.txt. Learn more about this file at llmstxt.org.
                  </FieldDescription>
                  <Textarea
                    id="llms"
                    value={llmsTxt}
                    onChange={(e) => setLlmsTxt(e.target.value)}
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <Field className="col-span-2">
                  <FieldLabel htmlFor="sitemap">
                    Sitemap
                  </FieldLabel>
                  <FieldDescription>
                    The sitemap.xml file improves your site&apos;s SEO by providing search engines with a detailed list of its pages. You can choose whether the file should be included or not and how its content should be configured.
                  </FieldDescription>

                  <Tabs value={activeSeoTab} onValueChange={handleSitemapTabChange}>
                    <TabsList className="w-full">
                      <TabsTrigger value="no-sitemap">No sitemap</TabsTrigger>
                      <TabsTrigger value="ycode-sitemap">Ycode generated</TabsTrigger>
                      <TabsTrigger value="custom-sitemap">Custom XML</TabsTrigger>
                    </TabsList>

                    <TabsContent value="no-sitemap" className="mt-4">
                      <p className="text-sm text-muted-foreground">
                        No sitemap.xml file will be generated for your website.
                      </p>
                    </TabsContent>

                    <TabsContent value="ycode-sitemap" className="mt-4 space-y-6">
                      <p className="text-sm text-muted-foreground">
                        The sitemap lists each localized URL as its own entry with reciprocal hreflang alternates and excludes pages marked with noindex.
                      </p>

                      <Field>
                        <FieldLabel htmlFor="sitemap-changefreq">
                          Change frequency
                        </FieldLabel>
                        <FieldDescription>
                          How frequently pages are likely to change (hint to search engines).
                        </FieldDescription>
                        <Select
                          value={sitemapSettings.defaultChangeFrequency || 'weekly'}
                          onValueChange={(value) => updateSitemapSetting('defaultChangeFrequency', value as SitemapChangeFrequency)}
                        >
                          <SelectTrigger id="sitemap-changefreq">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="always">Always</SelectItem>
                            <SelectItem value="hourly">Hourly</SelectItem>
                            <SelectItem value="daily">Daily</SelectItem>
                            <SelectItem value="weekly">Weekly</SelectItem>
                            <SelectItem value="monthly">Monthly</SelectItem>
                            <SelectItem value="yearly">Yearly</SelectItem>
                            <SelectItem value="never">Never</SelectItem>
                          </SelectContent>
                        </Select>
                      </Field>
                    </TabsContent>

                    <TabsContent value="custom-sitemap" className="mt-4">
                      <Field>
                        <FieldLabel htmlFor="custom-sitemap-xml">
                          Custom sitemap XML
                        </FieldLabel>
                        <FieldDescription>
                          Paste your custom sitemap XML content below. This will completely replace the auto-generated sitemap.
                        </FieldDescription>
                        <Textarea
                          id="custom-sitemap-xml"
                          value={sitemapSettings.customXml || ''}
                          onChange={(e) => updateSitemapSetting('customXml', e.target.value)}
                          placeholder={`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/</loc>
    <lastmod>2024-01-01</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
</urlset>`}
                          className="font-mono text-sm min-h-50"
                        />
                      </Field>
                    </TabsContent>
                  </Tabs>
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={saveSeoSettings}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save changes'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="custom-code" className="mt-2">
            <div className="grid grid-cols-3 gap-10 bg-secondary/20 p-8 rounded-lg">
              <div>
                <FieldLegend>Custom code</FieldLegend>
                <FieldDescription>Set up custom codes that should be added on your website.</FieldDescription>
              </div>

              <div className="col-span-2 grid grid-cols-2 gap-8">
                <Field className="col-span-2">
                  <FieldLabel htmlFor="global-code-head">
                    Header
                  </FieldLabel>
                  <FieldDescription>
                    Enter code that will be injected into the &lt;head&gt; tag on every page of your site.
                  </FieldDescription>
                  <CodeEditor
                    value={customCodeHead}
                    onValueChange={setCustomCodeHead}
                    placeholder={'<script src="..."></script>\n<link rel="stylesheet" href="...">'}
                    className="min-h-30"
                  />
                </Field>

                <Field className="col-span-2">
                  <FieldLabel htmlFor="global-code-body">
                    Body
                  </FieldLabel>
                  <FieldDescription>
                    Enter code that will be injected before the &lt;/body&gt; tag on every page of your site.
                  </FieldDescription>
                  <CodeEditor
                    value={customCodeBody}
                    onValueChange={setCustomCodeBody}
                    placeholder={'<script>...</script>'}
                    className="min-h-30"
                  />
                </Field>

                <FieldSeparator className="col-span-2" />

                <div className="col-span-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={saveCustomCodeSettings}
                    disabled={isSavingCustomCode}
                  >
                    {isSavingCustomCode ? 'Saving...' : 'Save changes'}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* File Manager Dialog for favicon/web clip selection */}
      <FileManagerDialog
        open={fileManagerOpen}
        onOpenChange={setFileManagerOpen}
        onAssetSelect={handleAssetSelect}
        assetId={fileManagerMode === 'favicon' ? faviconAssetId || null : webClipAssetId || null}
        category={fileManagerCategory}
      />

      {/* Reset Project Confirmation Dialog */}
      <Dialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <DialogContent showCloseButton={false} className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-base">Reset project</DialogTitle>
            <DialogDescription>
              This will permanently delete all project data including pages, CMS collections, assets, and settings. Your project will be reset to a blank canvas. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setShowResetDialog(false)}
              disabled={isResetting}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={handleResetProject}
              disabled={isResetting}
            >
              {isResetting ? (
                <>
                  <Spinner />
                  Resetting...
                </>
              ) : (
                'Reset project'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
