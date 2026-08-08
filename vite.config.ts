import { defineConfig } from "vite-plus";

/**
 * Workspace-root Vite+ configuration.
 *
 * Per-package `pack` / `test` config (and the `build:wasm` task that compiles
 * each crate) lives in the package's own `vite.config.ts`. This root config
 * holds the workspace-wide concerns: task caching, and the lint/format settings
 * applied across every package.
 */
export default defineConfig({
  run: {
    cache: true,
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
