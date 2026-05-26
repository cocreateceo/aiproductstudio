/**
 * CoCreate Projects — shared rendering helpers + detail modal.
 * Depends on window.PROJECTS_DATA (js/projects-data.js).
 * Used by projects.html (featured + search/all view) and
 * projects-category.html (per-category product list).
 *
 * Clicking a card opens a detail modal (overview + highlights + CTA).
 * Behaviour is wired via document-level delegation, so it works for any
 * cards rendered now or later — no per-page init required.
 */
(function () {
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Flatten all products and attach their category context + status.
  function flatten() {
    var out = [];
    (window.PROJECTS_DATA || []).forEach(function (cat) {
      cat.projects.forEach(function (p) {
        out.push(Object.assign({}, p, {
          catKey: cat.key,
          catName: cat.name,
          catIcon: cat.icon,
          isLive: !!(p.liveUrl && p.liveUrl !== '#')
        }));
      });
    });
    return out;
  }

  function categoryByKey(key) {
    return (window.PROJECTS_DATA || []).find(function (c) { return c.key === key; });
  }

  function bySlug(slug) {
    return flatten().find(function (p) { return p.slug === slug; });
  }

  // Live website thumbnail (thum.io): returns a loading frame on first hit per
  // URL, then serves the cached real screenshot. Cache is pre-warmed at deploy.
  function shotUrl(url) {
    return 'https://image.thum.io/get/width/800/crop/600/noanimate/' + url;
  }

  // Resolve a card/modal preview image for a project.
  //   p.shotImg  -> local asset (real screenshot or themed photo)
  //   else live  -> auto thum.io screenshot (unless noShot)
  // Returns { src, isPhoto } or null when there's no image (gradient+icon).
  function previewImage(p) {
    var live = !!(p.liveUrl && p.liveUrl !== '#');
    if (p.shotImg) return { src: p.shotImg, isPhoto: !!p.photo };
    if (live && !p.noShot) return { src: shotUrl(p.liveUrl), isPhoto: false, remote: true };
    return null;
  }

  // The gradient tile layers (initial watermark + category icon) shared by the
  // card and the modal header. The preview image overlays these when present.
  function tileLayers(p, img) {
    var initial = esc((p.name || '?').trim().charAt(0).toUpperCase());
    var icon = '<svg class="tile-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + esc(p.catIcon || '') + '"/></svg>';
    var shot = '';
    if (img) {
      shot = '<img class="tile-shot' + (img.isPhoto ? ' tile-shot--photo' : '') + '" src="' + esc(img.src) + '" ' +
        'alt="' + esc(p.name) + (img.isPhoto ? '' : ' preview') + '" loading="lazy" ' +
        (img.remote ? 'referrerpolicy="no-referrer" ' : '') + 'onerror="this.remove()">';
    }
    return '<span class="tile-initial">' + initial + '</span>' + icon + shot;
  }

  // Build one product card. `p` must include catName + catIcon (use flatten()).
  function productCardHTML(p, opts) {
    opts = opts || {};
    var live = !!(p.liveUrl && p.liveUrl !== '#');
    var img = previewImage(p);
    var catTag = opts.showCategory && p.catName
      ? '<div class="proj-cat-tag">' + esc(p.catName) + '</div>' : '';

    var badge = live
      ? '<span class="proj-badge live"><span class="dot"></span>Live</span>'
      : '<span class="proj-badge soon"><span class="dot"></span>Coming Soon</span>';

    var action = live
      ? '<a class="proj-visit" href="' + esc(p.liveUrl) + '" target="_blank" rel="noopener noreferrer">Visit Live' +
        '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>'
      : '<span class="proj-soon"><svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Coming Soon</span>';

    return '' +
      '<div class="proj-card" data-slug="' + esc(p.slug || '') + '" role="button" tabindex="0" aria-label="View details for ' + esc(p.name) + '">' +
        '<div class="proj-tile' + (img ? ' has-shot' : '') + '">' +
          tileLayers(p, img) +
          badge +
          '<span class="proj-tile-hint"><svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>View details</span>' +
        '</div>' +
        '<div class="proj-body">' +
          catTag +
          '<h3>' + esc(p.name) + '</h3>' +
          '<p>' + esc(p.description) + '</p>' +
          action +
        '</div>' +
      '</div>';
  }

  /* ----------------------------- Detail modal ----------------------------- */

  function modalHTML(p) {
    var live = !!(p.liveUrl && p.liveUrl !== '#');
    var img = previewImage(p);
    var badge = live
      ? '<span class="proj-badge live"><span class="dot"></span>Live</span>'
      : '<span class="proj-badge soon"><span class="dot"></span>Coming Soon</span>';

    var highlights = (p.highlights || []).map(function (h) {
      return '<li><svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' + esc(h) + '</li>';
    }).join('');
    var highlightsBlock = highlights ? '<ul class="proj-modal__highlights">' + highlights + '</ul>' : '';

    var action = live
      ? '<a class="proj-visit" href="' + esc(p.liveUrl) + '" target="_blank" rel="noopener noreferrer">Visit Live' +
        '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>'
      : '<span class="proj-soon"><svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Coming Soon</span>';

    return '' +
      '<div class="proj-modal__backdrop" data-close></div>' +
      '<div class="proj-modal__panel" role="dialog" aria-modal="true" aria-labelledby="pm-title">' +
        '<button class="proj-modal__close" data-close aria-label="Close details">' +
          '<svg width="22" height="22" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>' +
        '</button>' +
        '<div class="proj-tile proj-modal__media' + (img ? ' has-shot' : '') + '">' +
          tileLayers(p, img) +
          badge +
        '</div>' +
        '<div class="proj-modal__body">' +
          (p.catName ? '<div class="proj-cat-tag">' + esc(p.catName) + '</div>' : '') +
          '<h2 id="pm-title">' + esc(p.name) + '</h2>' +
          '<p class="proj-modal__overview">' + esc(p.overview || p.description || '') + '</p>' +
          highlightsBlock +
          '<div class="proj-modal__actions">' + action + '</div>' +
        '</div>' +
      '</div>';
  }

  var modalEl = null;
  var lastFocus = null;

  function ensureModal() {
    if (modalEl) return modalEl;
    modalEl = document.createElement('div');
    modalEl.className = 'proj-modal';
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.appendChild(modalEl);
    modalEl.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]')) closeDetail();
    });
    return modalEl;
  }

  function openDetail(slug) {
    var p = bySlug(slug);
    if (!p) return;
    var m = ensureModal();
    m.innerHTML = modalHTML(p);
    lastFocus = document.activeElement;
    m.classList.add('is-open');
    m.setAttribute('aria-hidden', 'false');
    document.body.classList.add('proj-modal-open');
    var closeBtn = m.querySelector('.proj-modal__close');
    if (closeBtn) closeBtn.focus();
  }

  function closeDetail() {
    if (!modalEl) return;
    modalEl.classList.remove('is-open');
    modalEl.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('proj-modal-open');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  // Document-level delegation: open on card click / Enter / Space, except when
  // the click lands on the "Visit Live" link (let that open the site).
  function initDelegation() {
    document.addEventListener('click', function (e) {
      if (e.target.closest('.proj-visit')) return;       // visit link wins
      if (e.target.closest('.proj-modal')) return;       // handled in-modal
      var card = e.target.closest('.proj-card[data-slug]');
      if (card) openDetail(card.getAttribute('data-slug'));
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') return closeDetail();
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var card = e.target.closest && e.target.closest('.proj-card[data-slug]');
      if (card && !e.target.closest('.proj-visit')) { e.preventDefault(); openDetail(card.getAttribute('data-slug')); }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDelegation);
  } else {
    initDelegation();
  }

  window.CoCreateProjects = {
    esc: esc,
    flatten: flatten,
    categoryByKey: categoryByKey,
    productCardHTML: productCardHTML,
    openDetail: openDetail,
    closeDetail: closeDetail
  };
})();
