import { defineConfig } from "vite-plus";

/**
 * Workspace-root Vite+ configuration.
 *
 * Per-package `pack` / `test` config (and the `build:wasm` task that compiles
 * each crate) lives in the package's own `vite.config.ts`. This root config
 * holds the workspace-wide concerns: task caching, the `ci` task that CI runs,
 * and the lint/format settings applied across every package.
 */
export default defineConfig({
  run: {
    cache: true,
    tasks: {
      // Everything CI checks, in the order it has to run: the build emits the
      // `wasm.generated.ts` that the type-check and the tests import, and the
      // tests run with coverage so its thresholds are enforced. The CI
      // workflow runs exactly this, so a green `vp run ci` locally is a green
      // CI run. It stops at the first failure.
      ci: {
        command: "vp run -r build && vp check && vp run -r test:coverage",
        cache: false,
      },
    },
  },

  /** `vp check` (Oxlint + tsgolint) — type-aware across all packages. */
  lint: {
    ignorePatterns: ["**/dist/**", "**/target/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
  },

  /** `vp check` (Oxfmt) */
  fmt: {
    // `*.generated.ts` is a multi-megabyte base64 blob emitted by
    // `build:wasm`; there is nothing to format and everything to slow down.
    ignorePatterns: ["**/dist/**", "**/target/**", "**/*.generated.ts"],
  },
});
