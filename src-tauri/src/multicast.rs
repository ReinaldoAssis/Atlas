//! `MulticastLock` do Android para o mDNS do sync.
//!
//! O Wi-Fi do Android descarta pacotes multicast quando nenhum app segura um
//! `MulticastLock` (economia de energia). Sem isso o `mdns-sd` anuncia mas não
//! recebe anúncios de outros aparelhos — a descoberta fica vazia.
//!
//! O lock é segurado só enquanto o sync está ligado (o app precisa estar
//! aberto de qualquer forma) e liberado no `sync_stop`. No desktop/iOS este
//! módulo é no-op.

/// Plugin Kotlin registrado em `gen/android/.../MulticastLockPlugin.kt`.
#[cfg(target_os = "android")]
pub struct Multicast<R: tauri::Runtime>(tauri::plugin::PluginHandle<R>);

#[cfg(target_os = "android")]
pub fn init<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
  tauri::plugin::Builder::new("multicast")
    .setup(|app, api| {
      use tauri::Manager;
      let handle = api.register_android_plugin("com.reinaldoassis.atlas", "MulticastLockPlugin")?;
      app.manage(Multicast(handle));
      Ok(())
    })
    .build()
}

#[cfg(target_os = "android")]
pub fn acquire<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
  use tauri::Manager;
  app
    .state::<Multicast<R>>()
    .0
    .run_mobile_plugin::<serde_json::Value>("acquire", ())
    .map(|_| ())
    .map_err(|error| format!("multicast lock: {error}"))
}

#[cfg(target_os = "android")]
pub fn release<R: tauri::Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
  use tauri::Manager;
  app
    .state::<Multicast<R>>()
    .0
    .run_mobile_plugin::<serde_json::Value>("release", ())
    .map(|_| ())
    .map_err(|error| format!("multicast lock: {error}"))
}

#[cfg(not(target_os = "android"))]
pub fn acquire<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Result<(), String> {
  Ok(())
}

#[cfg(not(target_os = "android"))]
pub fn release<R: tauri::Runtime>(_app: &tauri::AppHandle<R>) -> Result<(), String> {
  Ok(())
}
