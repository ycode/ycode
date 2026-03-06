/**
 * Shared Swiper configuration utilities used by both
 * SliderInitializer (production) and useCanvasSlider (canvas editor).
 */

import {
  Navigation,
  Pagination,
  Autoplay,
  Mousewheel,
  EffectFade,
  EffectCube,
  EffectFlip,
  EffectCoverflow,
  EffectCards,
} from 'swiper/modules';
import type { SwiperOptions } from 'swiper/types';
import type { SliderSettings, SwiperAnimationEffect } from '@/types';

/** Effect name → Swiper module mapping */
export const EFFECT_MODULES: Partial<Record<SwiperAnimationEffect, typeof EffectFade>> = {
  fade: EffectFade,
  cube: EffectCube,
  flip: EffectFlip,
  coverflow: EffectCoverflow,
  cards: EffectCards,
};

/** Effects that support slidesPerView > 1 */
export const EFFECTS_WITH_PER_VIEW = new Set<SwiperAnimationEffect>(['slide', 'coverflow']);

/** All Swiper modules needed for production (canvas uses a subset) */
export const ALL_SWIPER_MODULES = [Navigation, Pagination, Autoplay, Mousewheel];

/**
 * Build the shared base Swiper config from slider settings.
 * Covers options common to both canvas and production.
 */
export function buildBaseSwiperOptions(settings: SliderSettings): SwiperOptions {
  const modules = [...ALL_SWIPER_MODULES];
  const effectKey = settings.animationEffect;
  const effectModule = EFFECT_MODULES[effectKey];

  if (effectModule) modules.push(effectModule);

  const config: SwiperOptions = {
    modules,
    slidesPerView: 'auto',
    slidesPerGroup: settings.slidesPerGroup || 1,
    centeredSlides: settings.centered,
    speed: Math.round(parseFloat(settings.duration || '0.5') * 1000),
  };

  if (effectModule) {
    config.effect = effectKey as SwiperOptions['effect'];
  }

  if (settings.loop === 'loop') {
    config.loop = true;
  } else if (settings.loop === 'rewind') {
    config.rewind = true;
  }

  return config;
}

/**
 * Build the full production Swiper config (adds interactive options).
 */
export function buildProductionSwiperOptions(settings: SliderSettings): SwiperOptions {
  const config = buildBaseSwiperOptions(settings);

  config.allowTouchMove = settings.touchEvents;
  config.slideToClickedSlide = settings.slideToClicked;

  if (settings.navigation) {
    config.navigation = {
      nextEl: '[data-slider-next]',
      prevEl: '[data-slider-prev]',
    };
  }

  if (settings.pagination) {
    const isFraction = settings.paginationType === 'fraction';
    config.pagination = {
      el: isFraction ? '[data-slider-fraction]' : '[data-slider-pagination]',
      type: isFraction ? 'fraction' : 'bullets',
      clickable: settings.paginationClickable,
    };
  }

  if (settings.autoplay) {
    config.autoplay = {
      delay: Math.round(parseFloat(settings.delay || '3') * 1000),
      disableOnInteraction: false,
      pauseOnMouseEnter: settings.pauseOnHover ?? true,
    };
  }

  if (settings.mousewheel) {
    config.mousewheel = true;
  }

  return config;
}

/**
 * Build canvas-only Swiper config (all interactions disabled).
 */
export function buildCanvasSwiperOptions(settings: SliderSettings, ghostPaginationEl: HTMLElement): SwiperOptions {
  const config = buildBaseSwiperOptions(settings);

  config.simulateTouch = false;
  config.allowTouchMove = false;
  config.navigation = { enabled: false };
  config.pagination = {
    enabled: true,
    el: ghostPaginationEl,
    type: 'fraction',
  };
  config.autoplay = false;
  config.observer = true;
  config.observeParents = true;
  config.preventInteractionOnTransition = false;

  return config;
}

/** Apply easing to the Swiper wrapper's CSS transition-timing-function */
export function applySwiperEasing(swiperEl: HTMLElement, easing: string) {
  const wrapper = swiperEl.querySelector('.swiper-wrapper') as HTMLElement | null;
  if (wrapper) {
    wrapper.style.transitionTimingFunction = easing || 'ease-in-out';
  }
}

/**
 * Configure renderBullet to use the user's bullet element as a template,
 * merging Swiper's classes with the user's design.
 * current: classes are kept on the bullet — Tailwind compiles them
 * via the @custom-variant current (&[aria-current]) directive.
 */
export function configureBulletRenderer(el: HTMLElement, config: SwiperOptions) {
  const paginationEl = el.querySelector('[data-slider-pagination]');
  if (!paginationEl || !config.pagination || typeof config.pagination !== 'object') return;
  if (config.pagination.type !== 'bullets') return;

  const bulletEl = paginationEl.querySelector('[data-layer-id]');
  if (!bulletEl) return;

  const bulletHTML = bulletEl.outerHTML;

  config.pagination.renderBullet = (_index: number, className: string) => {
    const parts = bulletHTML.split('class="');
    if (parts.length < 2) return `<span class="${className}">${bulletHTML}</span>`;
    return parts[0] + 'class="' + className + ' ' + parts[1];
  };
}

/**
 * Sync HTML attributes with Swiper's state classes so Tailwind
 * variants work natively:
 * - Active bullet gets `aria-current` → `current:` variant activates
 * - Disabled nav buttons get `aria-disabled` → `disabled:` variant activates
 */
export function syncSliderStateAttributes(swiper: InstanceType<typeof import('swiper').default>) {
  const syncBullets = () => {
    const bullets = swiper.el.querySelectorAll('.swiper-pagination-bullet');
    bullets.forEach((bullet) => {
      if (bullet.classList.contains('swiper-pagination-bullet-active')) {
        bullet.setAttribute('aria-current', 'true');
      } else {
        bullet.removeAttribute('aria-current');
      }
    });
  };

  const syncNavButtons = () => {
    const buttons = swiper.el.querySelectorAll('[data-slider-prev], [data-slider-next]');
    buttons.forEach((btn) => {
      if (btn.classList.contains('swiper-button-disabled')) {
        btn.setAttribute('aria-disabled', 'true');
      } else {
        btn.removeAttribute('aria-disabled');
      }
    });
  };

  const syncAll = () => {
    syncBullets();
    syncNavButtons();
  };

  swiper.on('init', syncAll);
  swiper.on('slideChangeTransitionEnd', syncAll);
  swiper.on('paginationUpdate', syncBullets);
  swiper.on('navigationNext', syncNavButtons);
  swiper.on('navigationPrev', syncNavButtons);

  // Initial sync after mount
  requestAnimationFrame(syncAll);
}

/** Load minimal Swiper CSS into an iframe document via <link> tag */
export function loadSwiperCss(doc: Document) {
  const id = 'ycode-swiper-css';
  if (doc.getElementById(id)) return;
  const link = doc.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = '/swiper-minimal.css';
  doc.head.appendChild(link);
}
