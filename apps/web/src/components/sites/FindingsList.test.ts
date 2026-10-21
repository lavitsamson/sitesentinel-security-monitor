import { describe, expect, it } from 'vitest';
import { mountWithVuetify } from '../../test/mount';
import CheckCard from './CheckCard.vue';
import FindingsList from './FindingsList.vue';
import { makeRun } from '../../test/fixtures';

const findings = [
  {
    code: 'HSTS_MISSING_SUBDOMAINS',
    severity: 'low' as const,
    message: 'HSTS does not cover subdomains',
    recommendation: 'Add includeSubDomains to Strict-Transport-Security.',
  },
  {
    code: 'CSP_MISSING',
    severity: 'high' as const,
    message: 'No Content-Security-Policy header',
    recommendation: "Add a Content-Security-Policy header, starting with default-src 'self'.",
  },
  {
    code: 'SERVER_VERSION',
    severity: 'medium' as const,
    message: 'Server header reveals nginx/1.25.3',
    recommendation: 'Remove the version from the Server header (server_tokens off).',
  },
];

describe('FindingsList', () => {
  it('lists findings most severe first, each with its recommendation', () => {
    const wrapper = mountWithVuetify(FindingsList, { props: { findings } });

    const items = wrapper.findAll('[data-test="finding"]');
    expect(items.map((i) => i.get('[data-test="severity"]').text())).toEqual([
      'high',
      'medium',
      'low',
    ]);
    expect(items[0]?.get('[data-test="message"]').text()).toBe('No Content-Security-Policy header');
    expect(items[0]?.get('[data-test="recommendation"]').text()).toBe(
      "How to fix: Add a Content-Security-Policy header, starting with default-src 'self'.",
    );
  });

  it('says so when there are no findings', () => {
    const wrapper = mountWithVuetify(FindingsList, { props: { findings: [] } });

    expect(wrapper.get('[data-test="no-findings"]').text()).toBe('No issues found.');
  });

  it('renders text from findings as text, never as HTML', () => {
    const wrapper = mountWithVuetify(FindingsList, {
      props: {
        findings: [
          {
            code: 'X',
            severity: 'info',
            message: '<img src=x onerror=alert(1)>',
            recommendation: '<b>bold</b>',
          },
        ],
      },
    });

    expect(wrapper.find('img').exists()).toBe(false);
    expect(wrapper.get('[data-test="message"]').text()).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('CheckCard', () => {
  it('shows the check, its status, score and findings', () => {
    const run = makeRun({ type: 'SECURITY_HEADERS', status: 'WARN', score: 62, findings });
    const wrapper = mountWithVuetify(CheckCard, { props: { type: 'SECURITY_HEADERS', run } });

    expect(wrapper.text()).toContain('Security headers');
    expect(wrapper.text()).toContain('Warning');
    expect(wrapper.text()).toContain('Score 62/100');
    expect(wrapper.findAll('[data-test="finding"]')).toHaveLength(3);
  });

  it('says when a check has not run yet', () => {
    const wrapper = mountWithVuetify(CheckCard, { props: { type: 'TLS' } });

    expect(wrapper.text()).toContain('Not checked yet.');
  });
});
