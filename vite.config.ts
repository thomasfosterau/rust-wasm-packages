import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Compiles src/lib.rs to wasm32-unknown-unknown and emits
      // src/wasm.generated.ts. Every task that reads the module depends on it,
      // so the artifact is always rebuilt from the Rust source and can never
      // drift from it — that is the trade for not committing the wasm.
      "build:wasm": { command: "tsx scripts/build-wasm.ts", cache: false },
      check: {
        command: "tsc -p tsconfig.json",
        dependsOn: ["build:wasm"],
        cache: false,
      },
      "test:unit": {
        command: "vp test run tests",
        dependsOn: ["build:wasm"],
        cache: false,
      },
      "test:coverage": {
        command: "vp test run tests --coverage",
        dependsOn: ["build:wasm"],
        cache: false,
      },
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    ...(process.env.VITEST_MAX_WORKERS
      ? { maxWorkers: Number(process.env.VITEST_MAX_WORKERS) }
      : {}),
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      // The generated base64 blob is data, not logic.
      exclude: ["**/*.d.ts", "src/wasm.generated.ts"],
      // branches is 50 because the module has exactly two: the happy path and
      // a defensive `length < 0` throw that the public API cannot reach — the
      // cost parameters are module constants and the salt is always 16 bytes,
      // so the wasm `hash` export has no way to fail from here. Raising this
      // would require exporting internals purely to test an unreachable line.
      thresholds: { statements: 95, branches: 50, functions: 100, lines: 100 },
    },
  },
});
