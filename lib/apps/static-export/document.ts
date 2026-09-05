/**
 * Static export — HTML document assembly.
 *
 * Renders the visible body of a page through the same `layerToHtml`
 * pipeline the live site uses, then wraps it in a minimal HTML document
 * with SEO meta tags, inlined `published_css`, Swiper assets when a
 * slider is present, and a tiny interactions runtime for click→display
 * toggles.
 */

import { layerToHtml, buildAnchorMap } from '@/lib/page-fetcher'
import type { PageData } from '@/lib/page-fetcher'
import type { FontPreload } from '@/lib/font-utils'
import { getClassesString } from '@/lib/layer-utils'
import { getEffectiveApplyStyle } from '@/lib/animation-utils'
import { buildYcodeHtmlComments } from '@/lib/ycode-html-comment'

import type { Layer, Page, PageFolder } from '@/types'

/**
 * Extract the class string from the synthetic `body` layer so the exporter
 * can apply it to the real `<body>` element. The editor's Canvas does the
 * same thing — without it, the user's body background / text color / fonts
 * are silently dropped from the export.
 */
export function getBodyClasses(layers: Layer[] | null | undefined): string {
  if (!layers || layers.length === 0) return ''
  const bodyLayer = layers.find((l) => l.id === 'body' || l.name === 'body')
  return bodyLayer ? getClassesString(bodyLayer) : ''
}

// =============================================================================
// Render context + body rendering
// =============================================================================

export interface PageRenderContext {
  pages: Page[]
  folders: PageFolder[]
  components: PageData['components']
  locale: PageData['locale'] | null
  translations: PageData['translations'] | undefined
  /** ID of the page being rendered — drives `aria-current` on active-page links. */
  pageId?: string
}

/**
 * Render the visible body content of a page.
 *
 * Ycode wraps each page's layers in a synthetic `body` layer whose children
 * are the real content. We render those children directly so the output
 * doesn't carry an extra wrapper `<div>`.
 */
export function renderPageBody(
  layers: Layer[] | null | undefined,
  ctx: PageRenderContext,
): string {
  if (!layers || layers.length === 0) return ''

  const bodyLayer = layers.find((l) => l.id === 'body' || l.name === 'body')
  const contentLayers = bodyLayer?.children ?? layers

  // Anchors reference layer IDs; build the lookup once so generateLinkHref
  // can resolve `#section` style anchors anywhere in the page.
  const anchorMap = buildAnchorMap(layers)

  return contentLayers
    .map((layer) =>
      layerToHtml(
        layer,
        undefined, // collectionItemId — not in a CMS context
        ctx.pages,
        ctx.folders,
        undefined, // collectionItemSlugs — built per-collection in dynamic flows
        ctx.locale ?? null,
        ctx.translations,
        anchorMap,
        undefined, // collectionItemData
        undefined, // pageCollectionItemData
        undefined, // assetMap — already resolved into the layer tree
        undefined, // layerDataMap
        ctx.components,
        undefined, // ancestorComponentIds
        false, // isSlideChild
        { isStaticExport: true, currentPageId: ctx.pageId }, // pageLinkContext — opt out of iframe htmlEmbed wrapping
      ),
    )
    .filter(Boolean)
    .join('\n')
}

// =============================================================================
// SEO helpers
// =============================================================================

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

interface PageSeo {
  title?: string | null
  description?: string | null
  image?: string | { id?: string; public_url?: string } | null
  noindex?: boolean
}

function extractSeo(page: Page): PageSeo {
  const seo = (page.settings as { seo?: PageSeo } | undefined)?.seo
  return seo ?? {}
}

function resolveSeoImage(image: PageSeo['image']): string | null {
  if (!image) return null
  if (typeof image === 'string') return image
  if (typeof image === 'object' && image.public_url) return image.public_url
  return null
}

// =============================================================================
// Swiper bundling
// =============================================================================

// Swiper assets. We bundle Ycode's `public/swiper-minimal.css` rather than
// loading the full `swiper-bundle.min.css` from a CDN because the bundle
// sets `.swiper { display: block }` and `.swiper-slide { display: block }`
// which override the user's Tailwind `flex` utility at equal specificity.
// Major version is kept in sync with the `swiper` dependency in package.json
// so the export and the live builder render identically.
const SWIPER_VERSION = '12'
const SWIPER_JS_CDN = `https://cdn.jsdelivr.net/npm/swiper@${SWIPER_VERSION}/swiper-bundle.min.js`
export const SWIPER_CSS_PATH = '/swiper-minimal.css'

const SLIDER_BOOT_SCRIPT = `
(function () {
  if (typeof window === 'undefined') return;
  var SPECIAL_EFFECTS = { fade: 1, cube: 1, flip: 1, coverflow: 1, cards: 1 };

  function applyEasing(sliderEl, easing) {
    var wrapper = sliderEl.querySelector('.swiper-wrapper');
    if (wrapper) wrapper.style.transitionTimingFunction = easing || 'ease-in-out';
  }

  function configureBulletRenderer(sliderEl, paginationConfig) {
    var paginationEl = sliderEl.querySelector('[data-slider-pagination]');
    if (!paginationEl || !paginationConfig || paginationConfig.type !== 'bullets') return;
    var template = paginationEl.querySelector('[data-layer-id]');
    if (!template) return;
    var html = template.outerHTML;
    paginationConfig.renderBullet = function (_, className) {
      var parts = html.split('class="');
      if (parts.length < 2) return '<span class="' + className + '">' + html + '</span>';
      return parts[0] + 'class="' + className + ' ' + parts[1];
    };
  }

  function syncStateAttributes(swiper) {
    function syncBullets() {
      var bullets = swiper.el.querySelectorAll('.swiper-pagination-bullet');
      bullets.forEach(function (b) {
        if (b.classList.contains('swiper-pagination-bullet-active')) b.setAttribute('aria-current', 'true');
        else b.removeAttribute('aria-current');
      });
    }
    function syncNav() {
      var btns = swiper.el.querySelectorAll('[data-slider-prev], [data-slider-next]');
      btns.forEach(function (btn) {
        if (btn.classList.contains('swiper-button-disabled')) btn.setAttribute('aria-disabled', 'true');
        else btn.removeAttribute('aria-disabled');
      });
    }
    function syncAll() { syncBullets(); syncNav(); }
    swiper.on('init', syncAll);
    swiper.on('slideChangeTransitionEnd', syncAll);
    swiper.on('paginationUpdate', syncBullets);
    swiper.on('navigationNext', syncNav);
    swiper.on('navigationPrev', syncNav);
    requestAnimationFrame(syncAll);
  }

  // Resolve a responsive number (number or per-breakpoint object) using the
  // desktop-first fallback chain, mirroring lib/slider-utils.ts.
  var BP_FALLBACKS = { desktop: ['desktop'], tablet: ['tablet', 'desktop'], mobile: ['mobile', 'tablet', 'desktop'] };
  function resolveResp(value, bp, fallback) {
    if (value == null) return fallback;
    if (typeof value === 'number') return value;
    var chain = BP_FALLBACKS[bp];
    for (var i = 0; i < chain.length; i++) {
      if (typeof value[chain[i]] === 'number') return value[chain[i]];
    }
    return fallback;
  }

  function buildConfig(s) {
    // Per view 1 defers to each slide's own CSS width ('auto'); >1 forces a count.
    var perViewCount = function (bp) { return resolveResp(s.groupSlide, bp, 1); };
    var perView = function (bp) { var c = perViewCount(bp); return c > 1 ? c : 'auto'; };
    var perGroup = function (bp) { return Math.min(resolveResp(s.slidesPerGroup, bp, 1), perViewCount(bp)); };
    var config = {
      slidesPerView: perView('mobile'),
      slidesPerGroup: perGroup('mobile'),
      centeredSlides: !!s.centered,
      speed: Math.round((parseFloat(s.duration) || 0.5) * 1000),
      breakpoints: {
        768: { slidesPerView: perView('tablet'), slidesPerGroup: perGroup('tablet') },
        1024: { slidesPerView: perView('desktop'), slidesPerGroup: perGroup('desktop') },
      },
    };
    if (SPECIAL_EFFECTS[s.animationEffect]) config.effect = s.animationEffect;
    if (s.loop === 'loop') config.loop = true;
    else if (s.loop === 'rewind') config.rewind = true;

    config.allowTouchMove = !!s.touchEvents;
    config.slideToClickedSlide = !!s.slideToClicked;

    if (s.navigation) {
      config.navigation = {
        nextEl: '[data-slider-next]',
        prevEl: '[data-slider-prev]',
      };
    }
    if (s.pagination) {
      var isFraction = s.paginationType === 'fraction';
      config.pagination = {
        el: isFraction ? '[data-slider-fraction]' : '[data-slider-pagination]',
        type: isFraction ? 'fraction' : 'bullets',
        clickable: !!s.paginationClickable,
      };
    }
    if (s.autoplay) {
      config.autoplay = {
        delay: Math.round((parseFloat(s.delay) || 3) * 1000),
        disableOnInteraction: false,
        pauseOnMouseEnter: s.pauseOnHover !== false,
      };
    }
    if (s.mousewheel) config.mousewheel = true;
    return config;
  }

  function boot() {
    if (typeof window.Swiper !== 'function') {
      if (window.console) console.error('[Static Export] Swiper failed to load from CDN — sliders will not initialize.');
      return;
    }
    var sliders = document.querySelectorAll('[data-slider-id]');
    sliders.forEach(function (el) {
      var raw = el.getAttribute('data-slider-settings');
      if (!raw) return;
      var s; try { s = JSON.parse(raw); } catch (_) { return; }
      var config = buildConfig(s);
      configureBulletRenderer(el, config.pagination);
      try {
        var swiper = new window.Swiper(el, config);
        applyEasing(el, s.easing);
        syncStateAttributes(swiper);
        var pag = el.querySelector('[data-slider-pagination]');
        if (pag) pag.style.visibility = '';
      } catch (err) {
        if (window.console) console.error('[Static Export] Slider init failed:', err);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`.trim()

/**
 * Minimal interactions runtime for the static export. Reads a JSON blob
 * Ycode emits per-page and wires click→display toggles + breakpoint-aware
 * on-load hiding. Intentionally a tiny subset of what Ycode's React
 * AnimationInitializer + GSAP do at runtime.
 */
const INTERACTIONS_BOOT_SCRIPT = `
(function () {
  var el = document.getElementById('ycode-interactions');
  if (!el) return;
  var interactions;
  try { interactions = JSON.parse(el.textContent || '[]'); } catch (_) { return; }
  if (!interactions || !interactions.length) return;

  function currentBreakpoint() {
    var w = window.innerWidth;
    if (w < 768) return 'mobile';
    if (w < 1024) return 'tablet';
    return 'desktop';
  }

  function matchesBreakpoint(bps) {
    return !bps || !bps.length || bps.indexOf(currentBreakpoint()) >= 0;
  }

  function getEl(layerId) {
    return document.querySelector('[data-layer-id="' + layerId + '"]');
  }

  function setDisplay(target, value) {
    if (!target) return;
    if (value === 'hidden') target.style.display = 'none';
    else target.style.removeProperty('display');
  }

  function applyOnLoad() {
    interactions.forEach(function (i) {
      var inScope = matchesBreakpoint(i.breakpoints);
      i.tweens.forEach(function (t) {
        if (!t.applyDisplayOnLoad) return;
        var target = getEl(t.targetLayerId);
        if (!target) return;
        if (inScope && t.fromDisplay) setDisplay(target, t.fromDisplay);
        else target.style.removeProperty('display');
      });
    });
  }

  function applyLoadTriggers() {
    interactions.forEach(function (i) {
      if (i.trigger !== 'load') return;
      if (!matchesBreakpoint(i.breakpoints)) return;
      i.tweens.forEach(function (t) {
        var target = getEl(t.targetLayerId);
        if (!target) return;
        var value = t.toDisplay || t.fromDisplay;
        if (value) setDisplay(target, value);
      });
    });
  }

  function boot() {
    applyOnLoad();
    applyLoadTriggers();
    window.addEventListener('resize', applyOnLoad);

    interactions.forEach(function (i) {
      if (i.trigger !== 'click') return;
      var trigger = getEl(i.triggerLayerId);
      if (!trigger) return;
      trigger.addEventListener('click', function () {
        if (!matchesBreakpoint(i.breakpoints)) return;
        i.tweens.forEach(function (t) {
          var target = getEl(t.targetLayerId);
          if (!target) return;
          var isHidden = target.style.display === 'none'
            || getComputedStyle(target).display === 'none';
          setDisplay(target, isHidden ? 'visible' : 'hidden');
        });
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
`.trim()

/**
 * Visibility re-evaluation runtime for the static export. Reads
 * `data-ycode-vis-rule` data attributes (emitted by `layerToHtml` when
 * a layer's conditionalVisibility references a date preset like `$today`)
 * and re-evaluates the rule on page load, so layers gated on
 * time-relative dates flip across day boundaries without a re-export.
 *
 * The static export bakes the export-time evaluation into the page's
 * inline `display` style; this script only flips it when the *current*
 * evaluation diverges (i.e. enough days have passed since the export).
 */
const VISIBILITY_BOOT_SCRIPT = `
(function () {
  if (typeof document === 'undefined') return;

  function fmt(y, m0, d) { return new Date(Date.UTC(y, m0, d)).toISOString().slice(0, 10); }

  // Calendar Y/M/D (1-based month) of an instant as seen in a timezone.
  function tzParts(date, tz) {
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit'
      }).formatToParts(date);
      function get(t) { for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return Number(parts[i].value); return 0; }
      return { year: get('year'), month: get('month'), day: get('day') };
    } catch (_) {
      return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
    }
  }

  // UTC epoch ms for a wall-clock time interpreted in the given timezone.
  function zonedToUtc(y, m, d, h, mi, s, ms, tz) {
    var guess = Date.UTC(y, m - 1, d, h, mi, s, ms);
    try {
      var parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      }).formatToParts(new Date(guess));
      function get(t) { for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return Number(parts[i].value); return 0; }
      var wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
      return guess - (wall - guess);
    } catch (_) { return guess; }
  }

  // Mirror of resolveDatePreset: resolve a preset to YYYY-MM-DD bounds relative
  // to the current date in the project timezone.
  function resolvePreset(preset, tz) {
    var p = tzParts(new Date(), tz);
    var y = p.year, m = p.month - 1, d = p.day;
    switch (preset) {
      case '$today':
        return { start: fmt(y, m, d), end: fmt(y, m, d) };
      case '$this_week': {
        var dow = new Date(Date.UTC(y, m, d)).getUTCDay();
        var off = (dow + 6) % 7;
        return { start: fmt(y, m, d - off), end: fmt(y, m, d - off + 6) };
      }
      case '$this_month':
        return { start: fmt(y, m, 1), end: fmt(y, m + 1, 0) };
      case '$this_year':
        return { start: fmt(y, 0, 1), end: fmt(y, 11, 31) };
      case '$past_week':
        return { start: fmt(y, m, d - 7), end: fmt(y, m, d) };
      case '$past_month':
        return { start: fmt(y, m - 1, d), end: fmt(y, m, d) };
      case '$past_year':
        return { start: fmt(y - 1, m, d), end: fmt(y, m, d) };
      default:
        return null;
    }
  }

  // Mirror of dateStringToDayBounds: YYYY-MM-DD spans a full day in the project
  // timezone (UTC for date_only fields); any other value collapses to an instant.
  function dayBounds(value, tz, dateOnly) {
    if (!value) return null;
    if (/^\\d{4}-\\d{2}-\\d{2}$/.test(value)) {
      if (dateOnly) {
        var s = Date.parse(value + 'T00:00:00.000Z');
        var e = Date.parse(value + 'T23:59:59.999Z');
        if (isNaN(s) || isNaN(e)) return null;
        return { start: s, end: e };
      }
      var parts = value.split('-');
      var y = Number(parts[0]), mo = Number(parts[1]), da = Number(parts[2]);
      return { start: zonedToUtc(y, mo, da, 0, 0, 0, 0, tz), end: zonedToUtc(y, mo, da, 23, 59, 59, 999, tz) };
    }
    var ts = Date.parse(value);
    return isNaN(ts) ? null : { start: ts, end: ts };
  }

  // Mirror of resolveDateFilterValue.
  function resolveCompareValue(operator, value, tz) {
    if (typeof value !== 'string' || value.charAt(0) !== '$') {
      return { operator: operator, value: value, value2: undefined };
    }
    var range = resolvePreset(value, tz);
    if (!range) return { operator: operator, value: value, value2: undefined };
    switch (operator) {
      case 'is':
      case 'is_between':
        return { operator: 'is_between', value: range.start, value2: range.end };
      case 'is_before':
        return { operator: 'is_before', value: range.start };
      case 'is_after':
        return { operator: 'is_after', value: range.end };
      default:
        return { operator: 'is_between', value: range.start, value2: range.end };
    }
  }

  // Mirror of compareDateFilter.
  function compareDate(storedValue, operator, filterValue, filterValue2, tz, dateOnly) {
    var valueTs = Date.parse(storedValue);
    if (isNaN(valueTs)) return false;
    var bounds = dayBounds(filterValue, tz, dateOnly);
    if (!bounds) return false;
    switch (operator) {
      case 'is': return valueTs >= bounds.start && valueTs <= bounds.end;
      case 'is_before': return valueTs < bounds.start;
      case 'is_after': return valueTs > bounds.end;
      case 'is_between':
        var bounds2 = dayBounds(filterValue2, tz, dateOnly);
        if (!bounds2) return false;
        return valueTs >= bounds.start && valueTs <= bounds2.end;
      default: return false;
    }
  }

  function evaluateDynamicCondition(condition, tz) {
    var resolved = resolveCompareValue(condition.operator, condition.value, tz);
    return compareDate(condition.fieldValue || '', resolved.operator, resolved.value, resolved.value2, tz, !!condition.dateOnly);
  }

  // Mirror of evaluateVisibility: conditions OR within a group, groups AND,
  // empty groups skipped. Non-date conditions carry a baked export-time
  // result; date-preset conditions re-evaluate against the current date.
  function evaluateRule(payload) {
    var tz = (payload && payload.timezone) || 'UTC';
    var groups = (payload && payload.groups) || [];
    for (var i = 0; i < groups.length; i++) {
      var conditions = groups[i].conditions || [];
      if (conditions.length === 0) continue;
      var groupResult = false;
      for (var j = 0; j < conditions.length; j++) {
        var c = conditions[j];
        var ok = c.dynamic ? evaluateDynamicCondition(c, tz) : !!c.result;
        if (ok) { groupResult = true; break; }
      }
      if (!groupResult) return false;
    }
    return true;
  }

  function evaluateAll() {
    var nodes = document.querySelectorAll('[data-ycode-vis-rule]');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      try {
        var payload = JSON.parse(el.getAttribute('data-ycode-vis-rule'));
        if (evaluateRule(payload)) el.style.removeProperty('display');
        else el.style.display = 'none';
      } catch (_) { /* malformed payload — leave as-is */ }
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', evaluateAll);
  } else {
    evaluateAll();
  }
})();
`.trim()

// =============================================================================
// Interactions extraction
// =============================================================================

export interface ExportedInteraction {
  triggerLayerId: string
  trigger: 'click' | 'hover' | 'load' | 'scroll-into-view' | 'while-scrolling'
  breakpoints: string[]
  yoyo: boolean
  tweens: Array<{
    targetLayerId: string
    fromDisplay?: 'hidden' | 'visible'
    toDisplay?: 'hidden' | 'visible'
    applyDisplayOnLoad: boolean
  }>
}

export function collectInteractions(layers: Layer[]): ExportedInteraction[] {
  const collected: ExportedInteraction[] = []

  const visit = (layer: Layer) => {
    if (layer.interactions?.length) {
      for (const interaction of layer.interactions) {
        const tweens = (interaction.tweens ?? [])
          .filter((t) => t.layer_id)
          .map((t) => {
            const fromDisplay = t.from?.display
            const toDisplay = t.to?.display
            return {
              targetLayerId: t.layer_id,
              fromDisplay:
                fromDisplay === 'hidden' || fromDisplay === 'visible'
                  ? (fromDisplay as 'hidden' | 'visible')
                  : undefined,
              toDisplay:
                toDisplay === 'hidden' || toDisplay === 'visible'
                  ? (toDisplay as 'hidden' | 'visible')
                  : undefined,
              applyDisplayOnLoad: getEffectiveApplyStyle(interaction.trigger, 'display', t.apply_styles) === 'on-load',
            }
          })
          .filter((t) => t.fromDisplay !== undefined || t.toDisplay !== undefined)

        if (tweens.length === 0) continue

        collected.push({
          triggerLayerId: layer.id,
          trigger: interaction.trigger,
          breakpoints: interaction.timeline?.breakpoints ?? [],
          yoyo: interaction.timeline?.yoyo ?? false,
          tweens,
        })
      }
    }
    if (layer.children) for (const child of layer.children) visit(child)
  }
  for (const layer of layers) visit(layer)
  return collected
}

/** Scan a Tiptap JSON node for richTextComponent nodes and test their pre-resolved
 * layers against the layer name (embedded rich-text components). */
function tiptapTreeContains(node: any, name: string): boolean {
  if (!node || typeof node !== 'object') return false
  if (node.type === 'richTextComponent' && Array.isArray(node.attrs?._resolvedLayers)
    && layerTreeContains(node.attrs._resolvedLayers as Layer[], name)) {
    return true
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      if (tiptapTreeContains(child, name)) return true
    }
  }
  return false
}

export function layerTreeContains(layers: Layer[], name: string): boolean {
  for (const layer of layers) {
    if (layer.name === name) return true
    const textVar = layer.variables?.text as any
    if (textVar?.type === 'dynamic_rich_text' && textVar.data?.content
      && tiptapTreeContains(textVar.data.content, name)) {
      return true
    }
    if (layer.children && layerTreeContains(layer.children, name)) return true
  }
  return false
}

// =============================================================================
// Document assembly
// =============================================================================

export interface BuildHtmlInput {
  page: Page
  bodyHtml: string
  /** Class string from the synthetic `body` layer (background, text color, fonts). */
  bodyClasses?: string
  /** BCP-47 language code for the `<html lang>` attribute. Defaults to `'en'`. */
  lang?: string
  /** Pre-resolved OG image URL (e.g. `/a/{hash}/{slug}.webp`). */
  ogImageUrl?: string | null
  publishedCss: string | null
  colorVariablesCss: string | null
  /** Inlined @font-face + font class CSS for Google and custom fonts. */
  fontsCss?: string | null
  /** Custom font binaries to hint via `<link rel="preload" as="font">`. */
  fontPreloads?: FontPreload[]
  includeSwiper: boolean
  interactions: ExportedInteraction[]
  /** Site-wide custom code from Settings → General (head + body slots). */
  globalCustomCodeHead?: string | null
  globalCustomCodeBody?: string | null
  /**
   * Page-level custom code from `page.settings.custom_code.{head,body}`,
   * already placeholder-resolved by the resolver for dynamic pages.
   */
  pageCustomCodeHead?: string | null
  pageCustomCodeBody?: string | null
  /** ISO timestamp of the last publish, used for the HTML source stamp. */
  publishedAt?: string | null
}

export function buildDocument({
  page,
  bodyHtml,
  bodyClasses,
  lang = 'en',
  ogImageUrl,
  publishedCss,
  colorVariablesCss,
  fontsCss,
  fontPreloads,
  includeSwiper,
  interactions,
  globalCustomCodeHead,
  globalCustomCodeBody,
  pageCustomCodeHead,
  pageCustomCodeBody,
  publishedAt,
}: BuildHtmlInput): string {
  const seo = extractSeo(page)
  const title = seo.title || page.name
  const description = seo.description ?? ''
  const ogImage = ogImageUrl ?? resolveSeoImage(seo.image)
  const noindex = seo.noindex || page.error_page !== null

  const head: string[] = []
  head.push('<meta charset="UTF-8" />')
  head.push('<meta name="viewport" content="width=device-width, initial-scale=1.0" />')
  head.push('<meta name="generator" content="Ycode" />')
  head.push(`<title>${escapeHtml(title)}</title>`)
  if (description) {
    head.push(`<meta name="description" content="${escapeHtml(description)}" />`)
    head.push(`<meta property="og:description" content="${escapeHtml(description)}" />`)
  }
  head.push(`<meta property="og:title" content="${escapeHtml(title)}" />`)
  head.push(`<meta property="og:type" content="website" />`)
  if (ogImage) {
    head.push(`<meta property="og:image" content="${escapeHtml(ogImage)}" />`)
    head.push(`<meta name="twitter:card" content="summary_large_image" />`)
    head.push(`<meta name="twitter:image" content="${escapeHtml(ogImage)}" />`)
  }
  if (noindex) head.push('<meta name="robots" content="noindex" />')

  // Preload uploaded custom font binaries so the browser fetches them from
  // <head> instead of after CSS parsing. `crossorigin` is required — fonts are
  // always fetched in CORS mode.
  for (const font of fontPreloads ?? []) {
    head.push(
      `<link rel="preload" as="font" href="${escapeHtml(font.href)}" type="${escapeHtml(font.type)}" crossorigin="anonymous" />`,
    )
  }

  const css = [fontsCss, colorVariablesCss, publishedCss].filter(Boolean).join('\n')
  if (css) head.push(`<style>${css}</style>`)

  if (includeSwiper) {
    head.push(`<link rel="stylesheet" href="${SWIPER_CSS_PATH}" />`)
  }

  // Custom head code: global first (site-wide), then page-specific. Emitted
  // verbatim — the same trust model the live site uses (operator-authored
  // HTML/JS dropped straight into <head>).
  if (globalCustomCodeHead && globalCustomCodeHead.trim()) {
    head.push(globalCustomCodeHead)
  }
  if (pageCustomCodeHead && pageCustomCodeHead.trim()) {
    head.push(pageCustomCodeHead)
  }

  const indent = '  '
  const trailingScripts: string[] = []
  if (includeSwiper) {
    trailingScripts.push(`<script src="${SWIPER_JS_CDN}"></script>`)
    trailingScripts.push(`<script>${SLIDER_BOOT_SCRIPT}</script>`)
  }
  if (interactions.length > 0) {
    const safe = JSON.stringify(interactions).replace(/<\/(script)/gi, '<\\/$1')
    trailingScripts.push(`<script type="application/json" id="ycode-interactions">${safe}</script>`)
    trailingScripts.push(`<script>${INTERACTIONS_BOOT_SCRIPT}</script>`)
  }
  // Only ship the visibility runtime when the rendered body actually
  // contains a date-preset-driven rule — saves ~1.5 KB on pages that
  // don't use any dynamic-date visibility.
  if (bodyHtml.indexOf('data-ycode-vis-rule=') !== -1) {
    trailingScripts.push(`<script>${VISIBILITY_BOOT_SCRIPT}</script>`)
  }

  // Custom body code goes after the page body / scripts but before </body>,
  // matching the live site's ordering (global first, then page-specific).
  const customBodyChunks: string[] = []
  if (globalCustomCodeBody && globalCustomCodeBody.trim()) {
    customBodyChunks.push(globalCustomCodeBody)
  }
  if (pageCustomCodeBody && pageCustomCodeBody.trim()) {
    customBodyChunks.push(pageCustomCodeBody)
  }

  return [
    '<!DOCTYPE html>',
    ...buildYcodeHtmlComments(publishedAt).split('\n'),
    `<html lang="${escapeHtml(lang)}">`,
    '<head>',
    ...head.map((line) => indent + line),
    '</head>',
    bodyClasses ? `<body class="${escapeHtml(bodyClasses)}">` : '<body>',
    bodyHtml,
    ...trailingScripts,
    ...customBodyChunks,
    '</body>',
    '</html>',
    '',
  ].join('\n')
}
