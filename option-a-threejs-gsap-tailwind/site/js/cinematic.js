/* CoCreate · cinematic section behaviour.
   No-op if GSAP/ScrollTrigger aren't present. Honours reduced-motion. */
(function () {
  if (typeof window === 'undefined') return;
  function init() {
    if (!window.gsap || !window.ScrollTrigger) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.querySelectorAll('.cinematic').forEach(function (sec) {
      var bg = sec.querySelector('.cinematic__bg');
      if (!bg) return;
      window.gsap.to(bg, {
        yPercent: 12,
        ease: 'none',
        scrollTrigger: { trigger: sec, start: 'top bottom', end: 'bottom top', scrub: true }
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
