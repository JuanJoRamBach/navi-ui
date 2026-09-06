// NAVI's self-update check — only meaningful inside the Tauri desktop
// build (2026-09-06, the updater plugin was wired in alongside v0.3.1,
// the first version this repo's own GitHub Releases can publish a
// signed latest.json for). A plain web build (GitHub Pages) has no
// concept of "installed version" to update at all — isTauriRuntime()
// gates every function here to a real no-op outside Tauri, so this
// module is safe to import and call from anywhere in the app.
import { isTauriRuntime } from "./tauriRuntime";

export type UpdateCheckResult =
  | { status: "up-to-date" }
  | { status: "not-applicable" } // not running inside the desktop build
  | { status: "available"; version: string; date?: string; body?: string; install: () => Promise<void> }
  | { status: "error"; message: string };

// Dynamically imported (see BrowserPane.tsx's own comment on the same
// pattern) so a plain web build never even requests the Tauri-only JS
// packages this pulls in.
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  if (!isTauriRuntime()) return { status: "not-applicable" };
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) return { status: "up-to-date" };
    return {
      status: "available",
      version: update.version,
      date: update.date,
      body: update.body,
      install: async () => {
        // downloadAndInstall() exits the app itself on Windows once the
        // installer launches (real, documented behavior — not this
        // module's own choice) — relaunch() below only actually runs on
        // macOS/Linux, where the new binary needs an explicit restart.
        await update.downloadAndInstall();
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
      },
    };
  } catch (e) {
    return { status: "error", message: e instanceof Error ? e.message : String(e) };
  }
}
