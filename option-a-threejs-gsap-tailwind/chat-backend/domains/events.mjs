// domains/events.mjs — extracted from index.mjs (Phase 2 refactor)

// Computes the active Saturday's eventId in America/Chicago.
// Mirrors /event.html: if Sat before 11 AM CT, today; otherwise upcoming Saturday.
export function currentWeekEventId() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short'
  }).formatToParts(new Date());
  const get = (t) => parts.find(p => p.type === t).value;
  const year = +get('year'), month = +get('month'), day = +get('day');
  const hour = +get('hour') % 24;
  const weekday = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday'));
  let satOffset;
  if (weekday === 6 && hour < 11) satOffset = 0;
  else if (weekday === 6) satOffset = 7;
  else satOffset = (6 - weekday + 7) % 7;
  const d = new Date(Date.UTC(year, month - 1, day + satOffset));
  return 'build-product-2hrs-' + d.toISOString().slice(0, 10);
}

// Weekly "Build Your Product in 2 Hours" event resolver.
// Accepts eventId = "build-product-2hrs-YYYY-MM-DD" where the date is a Saturday.
// Static workshop details — only the date varies week to week.
export function resolveWeeklyEvent(eventId) {
  if (typeof eventId !== 'string') return null;
  const match = eventId.match(/^build-product-2hrs-(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, y, m, d] = match;
  const year = +y, month = +m, day = +d;
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) return null;
  if (dt.getUTCDay() !== 6) return null; // must be Saturday
  const dateLabel = dt.toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC'
  });
  return {
    title: 'Build Your Product in Less Than 2 Hours',
    date: dateLabel,                                        // e.g. "Saturday, April 25, 2026"
    time: '9:00 AM - 11:00 AM CST (Chicago)',
    zoomLink: 'https://us06web.zoom.us/j/2245204604?pwd=Yk9ReE42K080LzRoUXBPdzFNRFlvUT09',
    zoomMeetingId: '224 520 4604',
    zoomPasscode: '1234',
  };
}
