const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60],
  ['month', 30 * 24 * 60 * 60],
  ['week', 7 * 24 * 60 * 60],
  ['day', 24 * 60 * 60],
  ['hour', 60 * 60],
  ['minute', 60],
];

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });

/** "3 hours ago", "in 2 days", "just now". */
export function relativeTime(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return 'never';
  const seconds = Math.round((new Date(iso).getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relative.format(Math.trunc(seconds / size), unit);
  }
  return 'just now';
}

/** Time between two instants: "3 hours", "2 days", "under a minute". */
export function elapsed(fromIso: string, toIso: string): string {
  const seconds = Math.abs(new Date(toIso).getTime() - new Date(fromIso).getTime()) / 1000;
  for (const [unit, size] of UNITS) {
    if (seconds >= size) return plural(Math.floor(seconds / size), unit);
  }
  return 'under a minute';
}

const dateTimeFormat = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });
const shortDateFormat = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });

/** "Oct 21, 2026, 9:00 AM" in the viewer's time zone. */
export function dateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFormat.format(new Date(iso)) : '—';
}

/** "Oct 21" for a YYYY-MM-DD calendar day (UTC, as the API reports days). */
export function shortDate(day: string): string {
  return shortDateFormat.format(new Date(`${day}T00:00:00Z`));
}

/** "850 ms" or "3.2 s". */
export function duration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/** "1 site", "3 sites". */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`;
}
