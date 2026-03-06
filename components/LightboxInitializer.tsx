'use client';

/**
 * LightboxInitializer - Client component that initializes lightbox modals on production pages.
 * Finds all [data-lightbox-id] elements, reads settings from data-lightbox-settings,
 * and manages a fullscreen Swiper-based gallery modal.
 */

import { useEffect, useRef, useCallback, useState } from 'react';
import Swiper from 'swiper';
import {
  Navigation,
  Pagination,
  Keyboard,
  Thumbs,

  Zoom,
  Mousewheel,
} from 'swiper/modules';
import { EFFECT_MODULES, loadSwiperCss } from '@/lib/slider-utils';
import type { LightboxSettings } from '@/types';

interface LightboxState {
  open: boolean;
  files: string[];
  settings: LightboxSettings | null;
  initialIndex: number;
}

const CLOSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor" class="w-4 h-4"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>';
const PREV_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>';
const NEXT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor" class="w-5 h-5"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>';

export default function LightboxInitializer() {
  const [state, setState] = useState<LightboxState>({
    open: false,
    files: [],
    settings: null,
    initialIndex: 0,
  });
  const swiperMainRef = useRef<Swiper | null>(null);
  const swiperThumbsRef = useRef<Swiper | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const destroySwiperInstances = useCallback(() => {
    swiperMainRef.current?.destroy(true, true);
    swiperMainRef.current = null;
    swiperThumbsRef.current?.destroy(true, true);
    swiperThumbsRef.current = null;
  }, []);

  const handleClose = useCallback(() => {
    document.body.classList.remove('overflow-hidden');
    destroySwiperInstances();
    setState({ open: false, files: [], settings: null, initialIndex: 0 });
  }, [destroySwiperInstances]);

  // Keyboard handling
  useEffect(() => {
    if (!state.open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [state.open, handleClose]);

  // Click listeners for lightbox triggers
  useEffect(() => {
    loadSwiperCss(document);

    const handleClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const triggerEl = target.closest('[data-lightbox-id]') as HTMLElement | null;
      if (!triggerEl) return;

      event.preventDefault();
      const settingsJson = triggerEl.getAttribute('data-lightbox-settings');
      if (!settingsJson) return;

      try {
        const settings: LightboxSettings = JSON.parse(settingsJson);
        const groupId = settings.groupId;

        let files: string[];
        if (groupId) {
          // Merge files from all lightboxes in the same group
          const groupEls = document.querySelectorAll<HTMLElement>('[data-lightbox-id]');
          const seen = new Set<string>();
          const mergedFiles: string[] = [];
          groupEls.forEach((el) => {
            const elSettings = el.getAttribute('data-lightbox-settings');
            if (!elSettings) return;
            try {
              const parsed: LightboxSettings = JSON.parse(elSettings);
              if (parsed.groupId === groupId) {
                const elFiles = el.getAttribute('data-lightbox-files');
                if (elFiles) {
                  for (const url of elFiles.split(',').filter(Boolean)) {
                    if (!seen.has(url)) {
                      seen.add(url);
                      mergedFiles.push(url);
                    }
                  }
                }
              }
            } catch { /* skip malformed */ }
          });
          files = mergedFiles.length > 0 ? mergedFiles : settings.files;
        } else {
          const triggerFiles = triggerEl.getAttribute('data-lightbox-files');
          files = triggerFiles ? triggerFiles.split(',').filter(Boolean) : settings.files;
        }

        if (!files.length) return;

        // Determine initial slide
        const openTo = triggerEl.getAttribute('data-lightbox-open-to');
        let initialIndex = 0;
        if (openTo) {
          const idx = files.indexOf(openTo);
          if (idx >= 0) initialIndex = idx;
        }

        document.body.classList.add('overflow-hidden');
        setState({ open: true, files, settings, initialIndex });
      } catch {
        console.error('Failed to parse lightbox settings');
      }
    };

    document.addEventListener('click', handleClick, true);
    return () => document.removeEventListener('click', handleClick, true);
  }, []);

  // Initialize Swiper when modal opens
  const { open, settings: currentSettings, files: currentFiles, initialIndex } = state;
  useEffect(() => {
    if (!open || !currentSettings || !currentFiles.length) return;

    const timer = setTimeout(() => {
      const settings = currentSettings;
      if (!settings) return;

      const mainEl = modalRef.current?.querySelector('.lightbox-swiper-main');
      const thumbsEl = modalRef.current?.querySelector('.lightbox-swiper-thumbs');

      const showNavigation = settings.navigation !== false;
      const showPagination = settings.pagination !== false;
      const enableZoom = settings.zoom === true;
      const enableDoubleTapZoom = settings.doubleTapZoom === true;
      const enableMousewheel = settings.mousewheel === true;

      // Build modules list based on enabled features
      const mainModules = [Navigation, Pagination, Keyboard];
      if (settings.thumbnails) mainModules.push(Thumbs);
      if (enableZoom || enableDoubleTapZoom) mainModules.push(Zoom);
      if (enableMousewheel) mainModules.push(Mousewheel);
      const effectModule = EFFECT_MODULES[settings.animationEffect];
      if (effectModule) mainModules.push(effectModule);

      if (settings.thumbnails && thumbsEl) {
        swiperThumbsRef.current = new Swiper(thumbsEl as HTMLElement, {
          spaceBetween: 10,
          slidesPerView: 'auto',
          centeredSlides: true,
          watchSlidesProgress: true,
          slideToClickedSlide: true,
        });
      }

      if (mainEl) {
        swiperMainRef.current = new Swiper(mainEl as HTMLElement, {
          modules: mainModules,
          navigation: showNavigation ? {
            enabled: true,
            nextEl: modalRef.current?.querySelector('.lightbox-next') as HTMLElement,
            prevEl: modalRef.current?.querySelector('.lightbox-prev') as HTMLElement,
          } : false,
          pagination: showPagination ? {
            el: modalRef.current?.querySelector('.lightbox-pagination') as HTMLElement,
            enabled: true,
            type: 'fraction',
          } : false,
          thumbs: {
            swiper: settings.thumbnails && swiperThumbsRef.current ? swiperThumbsRef.current : undefined,
          },
          zoom: (enableZoom || enableDoubleTapZoom) ? {
            maxRatio: 3,
            toggle: enableDoubleTapZoom,
          } : false,
          mousewheel: enableMousewheel ? { enabled: true } : false,
          keyboard: { enabled: true },
          loop: settings.animationEffect !== 'cards' && settings.animationEffect !== 'coverflow',
          rewind: settings.animationEffect === 'cards' || settings.animationEffect === 'coverflow',
          effect: settings.animationEffect,
          speed: parseFloat(settings.duration || '0.5') * 1000,
          initialSlide: initialIndex,
        });

        if (swiperThumbsRef.current) {
          const thumbsSwiper = swiperThumbsRef.current;
          thumbsSwiper.slideTo(initialIndex, 0);
          swiperMainRef.current.on('slideChange', (swiper) => {
            thumbsSwiper.slideTo(swiper.realIndex);
          });
        }
      }
    }, 10);

    return () => clearTimeout(timer);
  }, [open, currentSettings, currentFiles, initialIndex]);

  if (!state.open || !state.settings) return null;

  const { files, settings } = state;
  const isDark = settings.overlay === 'dark';
  const showNavigation = settings.navigation !== false;
  const showPagination = settings.pagination !== false;
  const hasZoom = settings.zoom === true || settings.doubleTapZoom === true;

  const btnBase = 'flex cursor-pointer items-center justify-center rounded-full transition-all duration-200 focus:outline-none';
  const btnTheme = isDark
    ? 'bg-white/10 text-white/60 hover:bg-white/25 hover:text-white'
    : 'bg-black/5 text-black/70 hover:bg-black/15 hover:text-black';

  return (
    <div
      ref={modalRef}
      data-lightbox-modal
      className={`fixed inset-0 z-9999 flex flex-col overflow-hidden overscroll-none text-sm ${isDark ? 'bg-neutral-950 text-white' : 'bg-white text-black'}`}
      style={{
        animation: 'lightbox-fade-in 250ms ease-out',
      }}
    >
      <style>{`
        @keyframes lightbox-fade-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        .lightbox-swiper-thumbs .swiper-slide > div {
          opacity: 0.75;
          transition: opacity 0.2s ease, transform 0.2s ease;
        }
        .lightbox-swiper-thumbs .swiper-slide-thumb-active > div {
          opacity: 1;
          transform: scale(1.1);
        }
        .lightbox-swiper-thumbs .swiper-slide:hover > div {
          opacity: 1;
        }
        [data-lightbox-modal] .swiper-cube .swiper-cube-shadow:before,
        [data-lightbox-modal] .swiper-3d .swiper-slide-shadow,
        [data-lightbox-modal] .swiper-3d .swiper-slide-shadow-bottom,
        [data-lightbox-modal] .swiper-3d .swiper-slide-shadow-left,
        [data-lightbox-modal] .swiper-3d .swiper-slide-shadow-right,
        [data-lightbox-modal] .swiper-3d .swiper-slide-shadow-top { background: none !important; }
        [data-lightbox-modal] * { user-select: none; }
      `}</style>

      {/* Header: pagination + close */}
      <div className="flex shrink-0 items-center justify-between px-4 pb-1 pt-4 md:px-6 md:pt-5">
        {showPagination && files.length > 1 ? (
          <div
            className={`lightbox-pagination text-sm tabular-nums ${isDark ? 'text-white' : 'text-black'}`}
          />
        ) : (
          <div />
        )}
        <button
          onClick={handleClose}
          className={`${btnBase} ${btnTheme} gap-1.5 px-4 py-2 text-sm font-medium`}
          aria-label="Close lightbox"
        >
          <span>Close</span>
          <span dangerouslySetInnerHTML={{ __html: CLOSE_SVG }} />
        </button>
      </div>

      {/* Main content: nav + swiper */}
      <div className="relative min-h-0 flex-1">
        <div className="lightbox-swiper-main swiper h-full w-full overflow-hidden">
          <div
            className={`swiper-wrapper flex h-full overflow-visible ${settings.easing || 'ease-in-out'}`}
          >
            {files.map((file, index) => (
              <div
                key={index}
                className="swiper-slide flex shrink-0 items-center justify-center px-16 md:px-20"
              >
                {hasZoom ? (
                  <div className="swiper-zoom-container flex items-center justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={file}
                      alt=""
                      className="max-h-full max-w-full rounded-lg object-contain"
                    />
                  </div>
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={file}
                    alt=""
                    className="max-h-full max-w-full rounded-lg object-contain"
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Navigation */}
        {showNavigation && files.length > 1 && (
          <>
            <div className="absolute inset-y-0 left-4 z-40 flex items-center md:left-6">
              <button
                className={`lightbox-prev ${btnBase} ${btnTheme} p-3`}
                aria-label="Previous image"
              >
                <span dangerouslySetInnerHTML={{ __html: PREV_SVG }} />
              </button>
            </div>
            <div className="absolute inset-y-0 right-4 z-40 flex items-center md:right-6">
              <button
                className={`lightbox-next ${btnBase} ${btnTheme} p-3`}
                aria-label="Next image"
              >
                <span dangerouslySetInnerHTML={{ __html: NEXT_SVG }} />
              </button>
            </div>
          </>
        )}
      </div>

      {/* Thumbnails */}
      {settings.thumbnails && files.length > 1 && (
        <div className="lightbox-swiper-thumbs swiper shrink-0 overflow-hidden px-2 py-7">
          <div className="swiper-wrapper flex">
            {files.map((file, index) => (
              <div key={index} className="swiper-slide">
                <div className="h-16 w-20 cursor-pointer overflow-hidden rounded-lg transition-all duration-200 md:h-20 md:w-24">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={file}
                    alt=""
                    className="block h-full w-full object-cover"
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
