import { createJestConfig } from '@sitesentinel/config/jest';

const base = createJestConfig();

// The checks package is the heart of the product, so it holds a higher bar (CLAUDE.md §12).
export default {
  ...base,
  collectCoverage: true,
  coverageReporters: ['text-summary', 'lcov'],
  coverageThreshold: {
    global: { statements: 95, lines: 95, branches: 90, functions: 90 },
  },
};
