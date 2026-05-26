/**
 * CoCreate Projects — shared rendering helpers.
 * Depends on window.PROJECTS_DATA (js/projects-data.js).
 * Used by projects.html (featured + search/all view) and
 * projects-category.html (per-category product list).
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

  // Live website thumbnail (thum.io): returns a loading frame on first hit per
  // URL, then serves the cached real screenshot. Cache is pre-warmed at deploy.
  // If it fails to load, the <img> removes itself and the gradient+icon shows.
  function shotUrl(url) {
    return 'https://image.thum.io/get/width/800/crop/600/noanimate/' + url;
  }

  // Build one product card. `p` must include catName + catIcon (use flatten()).
  function productCardHTML(p, opts) {
    opts = opts || {};
    var live = !!(p.liveUrl && p.liveUrl !== '#');
    // Some live sites don't screenshot well (client-rendered SPAs that paint
    // blank, empty channels, etc.) — flag them noShot in the data to keep the
    // gradient+icon instead of a broken/blank preview.
    var useShot = live && !p.noShot;
    var initial = esc((p.name || '?').trim().charAt(0).toUpperCase());
    var catTag = opts.showCategory && p.catName
      ? '<div class="proj-cat-tag">' + esc(p.catName) + '</div>' : '';

    var badge = live
      ? '<span class="proj-badge live"><span class="dot"></span>Live</span>'
      : '<span class="proj-badge soon"><span class="dot"></span>Coming Soon</span>';

    var action = live
      ? '<a class="proj-visit" href="' + esc(p.liveUrl) + '" target="_blank" rel="noopener noreferrer">Visit Live' +
        '<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/></svg></a>'
      : '<span class="proj-soon"><svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>Coming Soon</span>';

    // Live projects get a real screenshot of the site; gradient+icon stay
    // underneath as the loading/fallback layer (img removes itself on error).
    var shot = useShot
      ? '<img class="tile-shot" src="' + esc(shotUrl(p.liveUrl)) + '" alt="' + esc(p.name) + ' live preview" ' +
        'loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">'
      : '';

    return '' +
      '<div class="proj-card">' +
        '<div class="proj-tile' + (useShot ? ' has-shot' : '') + '">' +
          '<span class="tile-initial">' + initial + '</span>' +
          '<svg class="tile-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="' + esc(p.catIcon || '') + '"/></svg>' +
          shot +
          badge +
        '</div>' +
        '<div class="proj-body">' +
          catTag +
          '<h3>' + esc(p.name) + '</h3>' +
          '<p>' + esc(p.description) + '</p>' +
          action +
        '</div>' +
      '</div>';
  }

  window.CoCreateProjects = {
    esc: esc,
    flatten: flatten,
    categoryByKey: categoryByKey,
    productCardHTML: productCardHTML
  };
})();
