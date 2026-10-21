// Shared Jest preset for Node packages. Tests run as native ESM via ts-jest,
// and workspace packages resolve to their TypeScript sources so tests never
// depend on a prior build.
/**
 * @param {{ kind?: 'unit' | 'int' }} [options]
 * @returns {import('jest').Config}
 */
export function createJestConfig({ kind = 'unit' } = {}) {
  const isInt = kind === 'int';

  return {
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    transform: {
      '^.+\\.ts$': ['ts-jest', { useESM: true, tsconfig: '<rootDir>/tsconfig.json' }],
    },
    moduleNameMapper: {
      '^@sitesentinel/(shared|checks|db)$': '<rootDir>/../../packages/$1/src/index.ts',
      '^@sitesentinel/shared/node$': '<rootDir>/../../packages/shared/src/node/index.ts',
      // Source uses NodeNext-style `./file.js` specifiers; map them back to the .ts files.
      '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    testMatch: isInt ? ['<rootDir>/src/**/*.int.test.ts'] : ['<rootDir>/src/**/*.test.ts'],
    testPathIgnorePatterns: isInt ? ['/node_modules/'] : ['/node_modules/', '\\.int\\.test\\.ts$'],
    collectCoverageFrom: [
      'src/**/*.ts',
      '!src/**/*.test.ts',
      '!src/test-utils.ts',
      '!src/test/**',
      '!src/main.ts',
    ],
    testTimeout: isInt ? 60_000 : 5_000,
  };
}
