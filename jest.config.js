module.exports = {
  testEnvironment: "node",
  setupFiles: ["./jest.setup.ts"],
  moduleNameMapper: {
    "^obsidian$": "<rootDir>/__mocks__/obsidian.ts",
    "^chart.js/auto$": "<rootDir>/__mocks__/chart.js.ts",
    "^chart.js$": "<rootDir>/__mocks__/chart.js.ts",
    "^chartjs-chart-matrix$": "<rootDir>/__mocks__/chartjs-chart-matrix.ts",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "CommonJS",
          moduleResolution: "node",
          esModuleInterop: true,
          allowSyntheticDefaultImports: true,
          strictNullChecks: true,
        },
      },
    ],
  },
};
