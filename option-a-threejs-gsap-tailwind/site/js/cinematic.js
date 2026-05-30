/* CoCreate · cinematic parallax — drives the --cc-bg-y CSS variable
   on <html> so body.cc-bg-fixed::before moves on scroll.
   No-op if GSAP/ScrollTrigger absent. Honours reduced-motion. */
(function () {
  function init() {
    if (typeof window === 'undefined') return;
    if (!window.gsap || !window.ScrollTrigger) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    var cinematic = document.querySelector('.cinematic');
    if (!cinematic) return;
    // Drive --cc-bg-y on <html> from 0px to 40px as the cinematic section scrolls.
    // background-position: center calc(100% + var(--cc-bg-y)) is in cc-bg.css.
    var html = document.documentElement;
    window.gsap.to(html, {
      '--cc-bg-y': '40px',
      ease: 'none',
      scrollTrigger: {
        trigger: cinematic,
        start: 'top bottom',
        end: 'bottom top',
        scrub: true
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
