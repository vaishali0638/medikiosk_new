/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  testRegex: '.*\\.spec\\.ts$',
  moduleNameMapper: {
    '^@medikiosk/api-contracts$': '<rootDir>/../../packages/api_contracts/src/index.ts',
    '^@medikiosk/terminology$': '<rootDir>/../../packages/terminology/src/index.ts',
    '^@medikiosk/his-adapter$': '<rootDir>/../his_adapter/src/index.ts',
    '^@medikiosk/questionnaire-schema$':
      '<rootDir>/../../packages/questionnaire_schema/src/index.ts',
  },
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts'],
};
