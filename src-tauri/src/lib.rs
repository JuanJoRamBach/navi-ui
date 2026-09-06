#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    // Desktop-only (mobile has no equivalent update flow via this
    // plugin) — matches how tauri-plugin-updater's own examples gate
    // it, and NAVI has no mobile Tauri target planned anyway.
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      #[cfg(desktop)]
      {
        app.handle().plugin(tauri_plugin_updater::Builder::new().build())?;
        // relaunch() after downloadAndInstall() — the updater plugin
        // itself only downloads and applies the new binary, it doesn't
        // restart into it.
        app.handle().plugin(tauri_plugin_process::init())?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
