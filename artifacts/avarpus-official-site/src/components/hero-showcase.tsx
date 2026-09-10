import React, { useEffect, useState } from 'react';
import useEmblaCarousel from 'embla-carousel-react';
import {
  DeviceMockup,
  ChatListScreen,
  StatusScreen,
  ChatRoomScreen,
  ShopScreen,
  RepairsScreen,
  KhataScreen,
} from './ui/mockup';

export function HeroShowcase() {
  const [reducedMotion, setReducedMotion] = useState(false);
  const [emblaRef1, emblaApi1] = useEmblaCarousel({
    duration: reducedMotion ? 0 : 25,
    loop: true,
    watchDrag: true,
  });
  const [emblaRef2, emblaApi2] = useEmblaCarousel({
    duration: reducedMotion ? 0 : 25,
    loop: true,
    watchDrag: true,
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const updatePreference = () => setReducedMotion(media.matches);
    updatePreference();
    media.addEventListener('change', updatePreference);
    return () => media.removeEventListener('change', updatePreference);
  }, []);

  useEffect(() => {
    if (reducedMotion) return;

    let intervalId1: NodeJS.Timeout;
    let intervalId2: NodeJS.Timeout;
    let isHovered = false;

    const play1 = () => {
      intervalId1 = setInterval(() => {
        if (!isHovered && emblaApi1 && emblaApi1.canScrollNext()) {
          emblaApi1.scrollNext();
        }
      }, 3500);
    };

    const play2 = () => {
      intervalId2 = setInterval(() => {
        if (!isHovered && emblaApi2 && emblaApi2.canScrollNext()) {
          emblaApi2.scrollNext();
        }
      }, 4500);
    };

    if (emblaApi1) play1();
    if (emblaApi2) play2();

    const pause = () => { isHovered = true; };
    const resume = () => { isHovered = false; };

    const container = document.getElementById('hero-showcase-container');
    container?.addEventListener('mouseenter', pause);
    container?.addEventListener('mouseleave', resume);
    container?.addEventListener('focusin', pause);
    container?.addEventListener('focusout', resume);

    // Also pause on drag/interaction
    emblaApi1?.on('pointerDown', pause);
    emblaApi1?.on('pointerUp', resume);
    emblaApi2?.on('pointerDown', pause);
    emblaApi2?.on('pointerUp', resume);

    return () => {
      clearInterval(intervalId1);
      clearInterval(intervalId2);
      container?.removeEventListener('mouseenter', pause);
      container?.removeEventListener('mouseleave', resume);
      container?.removeEventListener('focusin', pause);
      container?.removeEventListener('focusout', resume);
      emblaApi1?.off('pointerDown', pause);
      emblaApi1?.off('pointerUp', resume);
      emblaApi2?.off('pointerDown', pause);
      emblaApi2?.off('pointerUp', resume);
    };
  }, [emblaApi1, emblaApi2, reducedMotion]);

  return (
    <div id="hero-showcase-container" className="relative flex justify-center perspective-1000 w-full h-[550px] sm:h-[680px]">
      {/* Phone 1 (Back/Left) */}
      <div className="absolute left-[5%] sm:left-[2%] top-8 sm:top-12 z-20 opacity-95 hover:z-40 hover:opacity-100 transition-opacity duration-300">
        <DeviceMockup className="w-[230px] sm:w-[276px] h-[476px] sm:h-[570px]">
          <div
            aria-label="Communication screens: chats, status, and conversation"
            aria-roledescription="carousel"
            className="overflow-hidden h-full w-full touch-pan-y [touch-action:pan-y_pinch-zoom] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                emblaApi1?.scrollNext();
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                emblaApi1?.scrollPrev();
              }
            }}
            ref={emblaRef1}
            role="region"
            tabIndex={0}
          >
            <div className="flex h-full w-full cursor-grab active:cursor-grabbing">
              <div aria-label="1 of 3: Chats" className="flex-[0_0_100%] h-full min-w-0 select-none" role="group"><ChatListScreen /></div>
              <div aria-label="2 of 3: Status" className="flex-[0_0_100%] h-full min-w-0 select-none" role="group"><StatusScreen /></div>
              <div aria-label="3 of 3: Conversation" className="flex-[0_0_100%] h-full min-w-0 select-none" role="group"><ChatRoomScreen /></div>
            </div>
          </div>
        </DeviceMockup>
      </div>

      {/* Phone 2 (Front/Right) */}
      <div className="absolute right-[5%] sm:right-[8%] top-16 sm:top-24 z-30 hover:z-50">
        <DeviceMockup className="w-[240px] sm:w-[286px] h-[498px] sm:h-[590px] shadow-[0_30px_60px_-12px_rgba(0,0,0,0.7)]">
          <div
            aria-label="Business screens: shop, repairs, and ledger"
            aria-roledescription="carousel"
            className="overflow-hidden h-full w-full touch-pan-y [touch-action:pan-y_pinch-zoom] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white"
            onKeyDown={(event) => {
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                emblaApi2?.scrollNext();
              }
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                emblaApi2?.scrollPrev();
              }
            }}
            ref={emblaRef2}
            role="region"
            tabIndex={0}
          >
            <div className="flex h-full w-full cursor-grab active:cursor-grabbing">
              <div aria-label="1 of 3: Shop overview" className="flex-[0_0_100%] h-full min-w-0 select-none" role="group"><ShopScreen /></div>
              <div aria-label="2 of 3: Repair tracker" className="flex-[0_0_100%] h-full min-w-0 select-none" role="group"><RepairsScreen /></div>
              <div aria-label="3 of 3: Customer ledger" className="flex-[0_0_100%] h-full min-w-0 select-none" role="group"><KhataScreen /></div>
            </div>
          </div>
        </DeviceMockup>
      </div>

      {/* Swipe hints for accessibility/discoverability */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-4 pointer-events-none opacity-50 sm:opacity-0 transition-opacity duration-300 z-50">
         <div className="bg-black/60 text-white text-[10px] px-3 py-1 rounded-full backdrop-blur-md">Swipe to explore</div>
      </div>
    </div>
  );
}
