/**
 * Static export — orchestration.
 *
 * Pulls every published page, drives the per-page resolver, builds HTML
 * documents, bundles referenced assets, and hands the full output set
 * off to every configured writer.
 */

import { randomUUID } from 'crypto'

import { getAssetProxyUrl } from '@/lib/asset-utils'
import {
  buildCustomFontsCss,
  buildFontClassesCss,
  fetchGoogleFontsCss,
  getCustomFontPreloads,
  getGoogleFontLinks,
} from '@/lib/font-utils'
import type { FontPreload } from '@/lib/font-utils'
import { generateColorVariablesCss } from '@/lib/repositories/colorVariableRepository'
import { getAssetById } from '@/lib/repositories/assetRepository'
import { getPublishedFonts } from '@/lib/repositories/fontRepository'
import { getSettingByKey } from '@/lib/repositories/settingsRepository'
import { getTranslationsByLocale } from '@/lib/repositories/translationRepository'
import { getSupabaseAdmin } from '@/lib/supabase-server'

import type { Locale, Page, PageFolder } from '@/types'

import { collectPublicAssets, collectSupabaseAssets } from './asset-bundler'
import { getExportConfig, saveLastExportJob } from './config'
import { buildDocument, SWIPER_CSS_PATH } from './document'
import {
  buildTranslationsMap,
  resolvePages,
  type LocaleContext,
} from './resolver'
import type { ExportJob } from './types'
import { contentTypeFor, type OutputFile, type Writer } from './writers/types'
import { createGithubWriter } from './writers/github'
import { createLocalWriter } from './writers/local'
import { createS3Writer } from './writers/s3'

/**
 * Convert absolute paths to document-relative paths so exported HTML works
 * on any static host, subdirectory deployment, or local `file://` open.
 *
 * The prefix depends on how deep the output file is:
 *   `index.html`                     → `./`
 *   `about/index.html`               → `../`
 *   `services/training/index.html`   → `../../`
 *
 * Handles both bundled asset paths and internal page links.
 */
const ABSOLUTE_ASSET_RE = /(?<=["'\s,=])\/(?=a\/[A-Za-z0-9]{22}\/|ycode\/layouts\/assets\/|swiper-minimal\.css)/g
const INTERNAL_LINK_RE = /href="\/([^"]*?)"/g

function relativizePaths(html: string, outputKey: string): string {
  const depth = outputKey.split('/').length - 1
  const prefix = depth === 0 ? './' : '../'.repeat(depth)

  let result = html.replace(ABSOLUTE_ASSET_RE, prefix)

  result = result.replace(INTERNAL_LINK_RE, (_match, path: string) => {
    if (/^a\/[A-Za-z0-9]{22}\//.test(path)) return `href="${prefix}${path}"`
    if (path.startsWith('ycode/layouts/assets/')) return `href="${prefix}${path}"`

    const hashIdx = path.indexOf('#')
    const pathPart = hashIdx >= 0 ? path.slice(0, hashIdx) : path
    const hash = hashIdx >= 0 ? path.slice(hashIdx) : ''
    const trimmed = pathPart.replace(/^\/+/, '').replace(/\/+$/, '')

    if (!trimmed) return `href="${prefix}index.html${hash}"`
    return `href="${prefix}${trimmed}/index.html${hash}"`
  })

  return result
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function resolvePageOgImage(page: Page): Promise<string | null> {
  const seo = (page.settings as { seo?: { image?: unknown } } | undefined)?.seo
  if (!seo?.image) return null

  if (typeof seo.image === 'object' && (seo.image as { public_url?: string }).public_url) {
    return (seo.image as { public_url: string }).public_url
  }

  const raw = typeof seo.image === 'string' ? seo.image : (seo.image as { id?: string }).id
  if (!raw || !UUID_RE.test(raw)) return null

  try {
    const asset = await getAssetById(raw, true)
    if (!asset) return null
    return getAssetProxyUrl(asset) || asset.public_url || null
  } catch {
    return null
  }
}

export async function exportSite(presetJobId?: string): Promise<ExportJob> {
  const jobId = presetJobId ?? randomUUID()
  const job: ExportJob = {
    id: jobId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
    pagesExported: 0,
    filesWritten: 0,
  }

  await saveLastExportJob(job).catch(() => { /* non-fatal */ })

  try {
    const config = await getExportConfig()

    if (config.outputTargets.length === 0) {
      throw new Error('No output target selected — pick at least one of: local, S3, GitHub')
    }

    const client = await getSupabaseAdmin()
    if (!client) throw new Error('Supabase client not configured')

    // ---- Load pages (one query, all published, all routes) --------------
    const { data: pageRows, error: pagesError } = await client
      .from('pages')
      .select('*')
      .eq('is_published', true)
      .is('deleted_at', null)
      .order('depth', { ascending: true })
      .order('order', { ascending: true })

    if (pagesError) throw new Error(`Failed to fetch pages: ${pagesError.message}`)
    const pages = (pageRows ?? []) as Page[]
    if (pages.length === 0) {
      job.status = 'completed'
      job.completedAt = new Date().toISOString()
      await saveLastExportJob(job).catch(() => { /* non-fatal */ })
      return job
    }

    // ---- Folders + shared CSS + fonts + locales in parallel ---------------
    const [
      folderResult,
      publishedCss,
      colorVariablesCss,
      fonts,
      globalCustomCodeHead,
      globalCustomCodeBody,
      publishedAt,
      localeResult,
    ] = await Promise.all([
      client
        .from('page_folders')
        .select('*')
        .is('deleted_at', null)
        .order('depth', { ascending: true }),
      getSettingByKey('published_css').catch(() => null),
      generateColorVariablesCss().catch(() => null),
      getPublishedFonts().catch(() => []),
      getSettingByKey('custom_code_head').catch(() => null),
      getSettingByKey('custom_code_body').catch(() => null),
      getSettingByKey('published_at').catch(() => null),
      client
        .from('locales')
        .select('*')
        .eq('is_published', true)
        .is('deleted_at', null),
    ])
    if (folderResult.error) {
      throw new Error(`Failed to fetch folders: ${folderResult.error.message}`)
    }
    const folders = (folderResult.data ?? []) as PageFolder[]
    const locales = (localeResult.data ?? []) as Locale[]

    // The export always covers the default locale, plus one pass per
    // non-default published locale (writing to `<code>/...`).
    const defaultLocale = locales.find((l) => l.is_default) ?? null
    const additionalLocales = locales.filter((l) => !l.is_default)

    if (!publishedCss) {
      console.warn(
        '[Static Export] No published_css found — publish the site once to generate the CSS bundle.',
      )
    }

    // ---- Font CSS (Google inlined @font-face + custom @font-face + class rules)
    let fontsCss = ''
    let fontPreloads: FontPreload[] = []
    if (fonts.length > 0) {
      const googleLinks = getGoogleFontLinks(fonts)
      const [googleCss] = await Promise.all([
        googleLinks.length > 0
          ? fetchGoogleFontsCss(googleLinks).catch(() => '')
          : Promise.resolve(''),
      ])
      fontsCss = [googleCss, buildCustomFontsCss(fonts), buildFontClassesCss(fonts)]
        .filter(Boolean)
        .join('\n')
      fontPreloads = getCustomFontPreloads(fonts)
    }

    // ---- Render every page (default locale + per non-default locale) ----
    const outputs: OutputFile[] = []
    const referencedAssetPaths = new Set<string>()

    const renderPage = async (page: Page, ctx: LocaleContext): Promise<void> => {
      let yieldedAny = false
      const ogImageUrl = await resolvePageOgImage(page)
      try {
        for await (const resolved of resolvePages(page, folders, pages, ctx)) {
          yieldedAny = true
          const html = buildDocument({
            page: resolved.page,
            bodyHtml: resolved.bodyHtml,
            bodyClasses: resolved.bodyClasses,
            lang: resolved.lang,
            ogImageUrl,
            publishedCss: publishedCss ?? null,
            colorVariablesCss: colorVariablesCss ?? null,
            fontsCss: fontsCss || null,
            fontPreloads,
            includeSwiper: resolved.hasSlider,
            interactions: resolved.interactions,
            globalCustomCodeHead: globalCustomCodeHead ?? null,
            globalCustomCodeBody: globalCustomCodeBody ?? null,
            pageCustomCodeHead: resolved.pageCustomCodeHead,
            pageCustomCodeBody: resolved.pageCustomCodeBody,
            publishedAt: typeof publishedAt === 'string' ? publishedAt : null,
          })

          // Collect Ycode's built-in placeholder URLs referenced from this
          // page so we can ship them alongside the HTML for fully
          // self-contained hosting (collect before relativizing).
          for (const match of html.matchAll(/\/ycode\/layouts\/assets\/[^"'\s)]+/g)) {
            referencedAssetPaths.add(match[0])
          }

          // When a page contains a slider, bundle Ycode's minimal Swiper CSS
          // from /public — the export's <link> in <head> points at this path.
          if (resolved.hasSlider) {
            referencedAssetPaths.add(SWIPER_CSS_PATH)
          }

          const finalHtml = relativizePaths(html, resolved.outputKey)

          outputs.push({
            key: resolved.outputKey,
            body: finalHtml,
            contentType: contentTypeFor(resolved.outputKey),
          })
          job.pagesExported++
        }
      } catch (err) {
        const label = ctx.locale && !ctx.locale.is_default ? `[${ctx.locale.code}] ` : ''
        console.warn(
          `[Static Export] Failed to resolve ${label}"${page.name}" (${page.id}): ${
            err instanceof Error ? err.message : err
          }`,
        )
        return
      }
      if (!yieldedAny) {
        // Only warn for default-locale gaps; non-default locales legitimately
        // produce no routes for error pages etc.
        if (!ctx.locale || ctx.locale.is_default) {
          console.warn(`[Static Export] Skipping "${page.name}" — no routes produced`)
        }
      }
    }

    {
      const ctx: LocaleContext = { locale: defaultLocale, translations: {} }
      for (const page of pages) {
        await renderPage(page, ctx)
      }
    }

    for (const locale of additionalLocales) {
      const translations = await getTranslationsByLocale(locale.id, true)
      const translationsMap = buildTranslationsMap(translations)
      const ctx: LocaleContext = { locale, translations: translationsMap }
      for (const page of pages) {
        await renderPage(page, ctx)
      }
    }

    // ---- Bundle referenced /public placeholders -------------------------
    if (referencedAssetPaths.size > 0) {
      const assetFiles = await collectPublicAssets(Array.from(referencedAssetPaths))
      outputs.push(...assetFiles)
    }

    // ---- Bundle referenced Supabase-hosted assets -----------------------
    const supabaseAssetFiles = await collectSupabaseAssets(
      outputs.filter((o) => o.key.endsWith('.html')),
    )
    if (supabaseAssetFiles.length > 0) {
      outputs.push(...supabaseAssetFiles)
    }

    // ---- Flush to every configured target -------------------------------
    const writers: Writer[] = []
    for (const target of config.outputTargets) {
      if (target === 'local') writers.push(createLocalWriter(config))
      else if (target === 's3') writers.push(await createS3Writer(config))
      else if (target === 'github') writers.push(await createGithubWriter(config))
    }

    for (const writer of writers) {
      try {
        const count = await writer.flush(outputs)
        job.filesWritten += count
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        throw new Error(`Writer "${writer.name}" failed: ${message}`)
      }
    }

    job.status = 'completed'
    job.completedAt = new Date().toISOString()
    await saveLastExportJob(job).catch(() => { /* non-fatal */ })
    return job
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown export error'
    console.error(`[Static Export] Export ${jobId} failed:`, message)
    job.status = 'failed'
    job.completedAt = new Date().toISOString()
    job.error = message
    await saveLastExportJob(job).catch(() => { /* non-fatal */ })
    return job
  }
}
