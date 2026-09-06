// Detects whether this build is currently running inside the eventual
// Tauri desktop wrapper vs a plain browser tab (dev server, GitHub
// Pages) — the SAME built JS serves both; only the real Tauri host
// process injects these globals at runtime, so this has to be a
// runtime check, not a build-time flag.
//
// Checks both the v1 (`__TAURI__`) and v2 (`__TAURI_INTERNALS__`) globals
// since the actual Tauri wrapper project doesn't exist in this repo yet
// (2026-09-06, JuanJo: "that will be the last part, then we make the
// Tauri file") — whichever major version that ends up targeting, this
// keeps working without needing to come back and change the check.
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as Record<string, unknown>;
  return Boolean(w.__TAURI__ || w.__TAURI_INTERNALS__);
}
