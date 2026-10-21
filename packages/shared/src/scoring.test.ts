import { CHECK_TYPES } from './enums.js';
import {
  CHECK_WEIGHTS,
  SECURITY_HEADER_POINTS,
  gradeFor,
  overallScore,
  scoreFromFindings,
  securityHeadersStatus,
  statusFromFindings,
  type ScoredCheck,
} from './scoring.js';

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

describe('weights', () => {
  it('cover every check type and sum to 100', () => {
    expect(Object.keys(CHECK_WEIGHTS).sort()).toEqual([...CHECK_TYPES].sort());
    expect(sum(Object.values(CHECK_WEIGHTS))).toBe(100);
  });

  it('give security headers 100 points in total', () => {
    expect(sum(Object.values(SECURITY_HEADER_POINTS))).toBe(100);
  });
});

describe('gradeFor', () => {
  it.each([
    [100, 'A'],
    [90, 'A'],
    [89.9, 'B'],
    [80, 'B'],
    [79, 'C'],
    [70, 'C'],
    [69, 'D'],
    [60, 'D'],
    [59, 'F'],
    [0, 'F'],
  ] as const)('grades %d as %s', (score, grade) => {
    expect(gradeFor(score)).toBe(grade);
  });
});

describe('scoreFromFindings / statusFromFindings', () => {
  it('passes with no findings', () => {
    expect(scoreFromFindings([])).toBe(100);
    expect(statusFromFindings([])).toBe('PASS');
  });

  it('treats info and low findings as advice', () => {
    const findings = [{ severity: 'info' as const }, { severity: 'low' as const }];
    expect(scoreFromFindings(findings)).toBe(90);
    expect(statusFromFindings(findings)).toBe('PASS');
  });

  it('warns on medium and fails on high', () => {
    expect(statusFromFindings([{ severity: 'low' }, { severity: 'medium' }])).toBe('WARN');
    expect(statusFromFindings([{ severity: 'medium' }, { severity: 'high' }])).toBe('FAIL');
  });

  it('never goes below zero', () => {
    expect(
      scoreFromFindings([{ severity: 'high' }, { severity: 'high' }, { severity: 'low' }]),
    ).toBe(0);
  });
});

describe('securityHeadersStatus', () => {
  it.each([
    [100, 'PASS'],
    [80, 'PASS'],
    [79, 'WARN'],
    [50, 'WARN'],
    [49, 'FAIL'],
  ] as const)('%d → %s', (score, status) => {
    expect(securityHeadersStatus(score)).toBe(status);
  });
});

describe('overallScore', () => {
  const all = (score: number): ScoredCheck[] =>
    CHECK_TYPES.map((type) => ({ type, status: 'PASS', score }));

  it('is null before anything has been scored', () => {
    expect(overallScore([])).toBeNull();
    expect(overallScore([{ type: 'TLS', status: 'ERROR', score: 0 }])).toBeNull();
  });

  it('is the plain score when every check agrees', () => {
    expect(overallScore(all(72))).toBe(72);
  });

  it('weights each check (TLS 30, headers 25, redirect 15, email 15, security.txt 5, uptime 10)', () => {
    const results: ScoredCheck[] = [
      { type: 'TLS', status: 'PASS', score: 100 },
      { type: 'SECURITY_HEADERS', status: 'FAIL', score: 0 },
      { type: 'HTTPS_REDIRECT', status: 'PASS', score: 100 },
      { type: 'EMAIL_DNS', status: 'WARN', score: 50 },
      { type: 'SECURITY_TXT', status: 'PASS', score: 90 },
      { type: 'UPTIME', status: 'PASS', score: 100 },
    ];
    // (3000 + 0 + 1500 + 750 + 450 + 1000) / 100
    expect(overallScore(results)).toBe(67);
  });

  it('leaves out ERROR results and renormalises the remaining weights', () => {
    const results: ScoredCheck[] = [
      { type: 'TLS', status: 'PASS', score: 100 },
      { type: 'UPTIME', status: 'PASS', score: 50 },
      { type: 'SECURITY_HEADERS', status: 'ERROR', score: 0 },
    ];
    // (3000 + 500) / 40
    expect(overallScore(results)).toBe(88);
  });

  it('uses the last result given for a check type', () => {
    expect(
      overallScore([
        { type: 'TLS', status: 'FAIL', score: 0 },
        { type: 'TLS', status: 'PASS', score: 95 },
      ]),
    ).toBe(95);
  });
});
