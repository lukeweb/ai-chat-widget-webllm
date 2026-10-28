/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  moduleNameMapper: {
    "^@/config/appConfig$": "<rootDir>/tests/mocks/appConfigMock.cjs",
    "^@/(.*)$": "<rootDir>/src/$1",
    "^\\./aiEngine\\.worker\\?worker&inline$": "<rootDir>/tests/mocks/workerMock.ts",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          target: "ES2022",
          esModuleInterop: true,
          isolatedModules: true,
        },
      },
    ],
  },
};
