import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      // Compiles src/lib.rs to wasm32-unknown-unknown and emits
      // src/wasm.generated.ts. Every task that reads the module depends on it,
      // so the artifact is always rebuilt from the Rust source and can never
      // drift from it — that is the trade for not committing the wasm.
      //
      // Uncached: cargo does its own incremental caching, and the emitted file
      // is an input to everything below, so a stale cache hit here would be
      // silently wrong.
      "build:wasm": { command: "vpx scripts/build-wasm.ts", cache: false },
      build: {
        command: "vp pack",
        dependsOn: ["build:wasm"],
        cache: false,
      },
      // The tests depend on `build`, not just `build:wasm`: the workerd tests
      // load `dist/index.js`, the bundle that is published, into the real
      // Workers runtime.
      test: {
        command: "vp test run",
        dependsOn: ["build"],
        cache: false,
      },
      "test:coverage": {
        command: "vp test run --coverage",
        dependsOn: ["build"],
        cache: false,
      },
    },
  },

  /**
   * `vp pack` (tsdown) builds the publishable library.
   *
   * Deliberately **bundled** (not `unbundle`): the wasm arrives as a base64
   * string constant in `src/wasm.generated.ts`, and inlining it into
   * `dist/index.js` is what makes the published package self-contained — a
   * consumer needs no Rust toolchain and no asset-resolution support.
   *
   * `platform: "neutral"` because the module touches neither Node nor the DOM;
   * it wants only `WebAssembly` and `crypto.getRandomValues`, which workerd,
   * Deno, browsers, and Node all provide.
   */
  pack: {
    entry: ["src/index.ts"],
    format: ["esm"],
    platform: "neutral",
    dts: true,
    sourcemap: true,
  },

  /** `vp test` (Vitest) */
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    coverage: {
      provider: "istanbul",
      reporter: ["text-summary", "json-summary"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      // The generated base64 blob is data, not logic.
      exclude: ["**/*.d.ts", "src/wasm.generated.ts"],
      // What is left uncovered is three defensive checks on the wasm module's
      // return codes (a negative length from the two hash entry points, an
      // unknown code from `verify_with`). The arguments are validated before
      // the call, so no input reaches them through the public API.
      thresholds: { statements: 97, branches: 90, functions: 100, lines: 99 },
    },
  },
});
