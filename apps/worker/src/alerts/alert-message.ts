import { CHECK_TYPE_LABELS, type CheckType, type DeliveryEvent } from '@sitesentinel/shared';

export interface AlertIncident {
  id: string;
  type: CheckType;
  summary: string;
  openedAt: Date;
  resolvedAt: Date | null;
}

export interface AlertSite {
  id: string;
  domain: string;
  displayName: string;
}

export type AlertSubject =
  { event: 'TEST' } | { event: 'OPENED' | 'RESOLVED'; incident: AlertIncident; site: AlertSite };

/** The JSON body of a webhook alert. `text` makes it postable to a Slack incoming webhook as-is. */
export interface WebhookPayload {
  event: 'incident.opened' | 'incident.resolved' | 'test';
  text: string;
  sentAt: string;
  incident: {
    id: string;
    type: CheckType;
    summary: string;
    openedAt: string;
    resolvedAt: string | null;
    url: string;
  } | null;
  site: { id: string; domain: string; displayName: string } | null;
}

export interface AlertMessage {
  event: DeliveryEvent;
  subject: string;
  /** Plain-text email body. */
  text: string;
  payload: WebhookPayload;
}

/** "3h 5m", "2d 4h", "45s": how long an incident lasted. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const d = Math.floor(s / 86_400);
  const h = Math.floor((s % 86_400) / 3_600);
  const m = Math.floor((s % 3_600) / 60);
  if (d) return h ? `${d}d ${h}h` : `${d}d`;
  if (h) return m ? `${h}h ${m}m` : `${h}h`;
  if (m) return `${m}m`;
  return `${s}s`;
}

const siteLabel = (site: AlertSite) =>
  site.displayName === site.domain ? site.domain : `${site.displayName} (${site.domain})`;

/** Builds the email and webhook forms of one alert from the same facts, so they never disagree. */
export function buildAlertMessage(
  subject: AlertSubject,
  webOrigin: string,
  sentAt: Date,
): AlertMessage {
  if (subject.event === 'TEST') {
    const text =
      'Test alert from SiteSentinel. This channel is set up correctly and will receive incident alerts.';
    return {
      event: 'TEST',
      subject: '[SiteSentinel] Test alert',
      text: [text, '', `Manage alert channels: ${webOrigin}/alert-channels`].join('\n'),
      payload: { event: 'test', text, sentAt: sentAt.toISOString(), incident: null, site: null },
    };
  }

  const { incident, site, event } = subject;
  const url = `${webOrigin}/sites/${site.id}`;
  const check = CHECK_TYPE_LABELS[incident.type];
  const opened = event === 'OPENED';
  const duration =
    incident.resolvedAt &&
    formatDuration(incident.resolvedAt.getTime() - incident.openedAt.getTime());
  const headline = opened
    ? `Incident opened on ${siteLabel(site)}: ${incident.summary}`
    : `Resolved on ${siteLabel(site)} after ${duration ?? 'a while'}: ${incident.summary}`;

  return {
    event,
    subject: `[SiteSentinel] ${opened ? 'Incident' : 'Resolved'}: ${site.domain} ${check}`,
    text: [
      headline,
      '',
      `Check: ${check}`,
      `Opened: ${incident.openedAt.toISOString()}`,
      ...(incident.resolvedAt ? [`Resolved: ${incident.resolvedAt.toISOString()}`] : []),
      '',
      `Details and recommendations: ${url}`,
      '',
      'You receive this because this address is an alert channel on your SiteSentinel account.',
      `Manage alert channels: ${webOrigin}/alert-channels`,
    ].join('\n'),
    payload: {
      event: opened ? 'incident.opened' : 'incident.resolved',
      text: `[SiteSentinel] ${headline} ${url}`,
      sentAt: sentAt.toISOString(),
      incident: {
        id: incident.id,
        type: incident.type,
        summary: incident.summary,
        openedAt: incident.openedAt.toISOString(),
        resolvedAt: incident.resolvedAt?.toISOString() ?? null,
        url,
      },
      site: { id: site.id, domain: site.domain, displayName: site.displayName },
    },
  };
}
