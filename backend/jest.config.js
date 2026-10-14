/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/test"],
  globalSetup: "<rootDir>/test/setup/globalSetup.ts",
  setupFilesAfterEnv: ["<rootDir>/test/setup/afterEnv.ts"],
  testTimeout: 15000,
};
