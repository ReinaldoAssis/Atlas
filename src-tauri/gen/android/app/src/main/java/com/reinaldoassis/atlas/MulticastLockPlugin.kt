package com.reinaldoassis.atlas

import android.app.Activity
import android.content.Context
import android.net.wifi.WifiManager
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin

/**
 * Segura um `MulticastLock` enquanto o sync está ligado.
 *
 * Sem o lock o Android descarta multicast em economia de energia e o `mdns-sd`
 * do Rust nunca recebe os anúncios dos outros aparelhos. O lock é liberado no
 * `sync_stop` para não manter a rádio acordada à toa.
 */
@TauriPlugin
class MulticastLockPlugin(private val activity: Activity) : Plugin(activity) {
  private var lock: WifiManager.MulticastLock? = null

  @Command
  fun acquire(invoke: Invoke) {
    try {
      if (lock == null) {
        val wifi =
          activity.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        lock = wifi.createMulticastLock("atlas-sync-mdns").apply { setReferenceCounted(false) }
      }
      lock?.acquire()
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.message ?: "multicast lock indisponível")
    }
  }

  @Command
  fun release(invoke: Invoke) {
    try {
      lock?.let { if (it.isHeld) it.release() }
      invoke.resolve()
    } catch (error: Exception) {
      invoke.reject(error.message ?: "multicast lock indisponível")
    }
  }
}
