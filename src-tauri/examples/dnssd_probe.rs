//! Sonda da descoberta iOS (`discovery_ios.rs`) rodando no macOS.
//!
//! O módulo usa só `dns_sd.h` (libSystem) + `libc`, então o mesmo código roda
//! aqui e revela os erros que só aparecem no device. Ferramenta de diagnóstico:
//! `tools/dnssd-probe.sh` (não faz parte do app).
//!
//! Nos alvos não-Apple o exemplo compila vazio, para o `cargo test` do CI
//! (Linux/Windows) não tentar linkar símbolos do DNS-SD.

// A sonda usa só parte do módulo; o resto é do app.
#![allow(dead_code)]

#[cfg(target_os = "macos")]
#[path = "../src/sync/discovery_ios.rs"]
mod discovery_ios;

#[cfg(not(target_os = "macos"))]
fn main() {
  eprintln!("dnssd_probe: só roda no macOS (dns_sd.h/libSystem).");
}

#[cfg(target_os = "macos")]
fn main() {
  use std::time::Duration;

  struct Logger;

  impl log::Log for Logger {
    fn enabled(&self, _metadata: &log::Metadata) -> bool {
      true
    }
    fn log(&self, record: &log::Record) {
      eprintln!("[{}] {}", record.target(), record.args());
    }
    fn flush(&self) {}
  }

  static LOGGER: Logger = Logger;

  let _ = log::set_logger(&LOGGER);
  log::set_max_level(log::LevelFilter::Info);
  let args: Vec<String> = std::env::args().skip(1).collect();
  let name = args.first().cloned().unwrap_or_else(|| "Atlas probe".to_string());
  let seconds: u64 = args
    .get(1)
    .and_then(|value| value.parse().ok())
    .unwrap_or(12);
  // Id único por processo: duas sondas (ou sonda + app) se enxergam.
  let id = format!("probe-{:x}", std::process::id());
  println!("== dnssd_probe: nome={name} id={id} segundos={seconds}");

  let discovery = match discovery_ios::Discovery::start(&id, &name, 61234) {
    Ok(discovery) => discovery,
    Err(error) => {
      println!("start falhou: {error}");
      return;
    }
  };

  for step in 0..seconds {
    std::thread::sleep(Duration::from_secs(1));
    let report = discovery.report();
    println!(
      "{step:>2}s state={} found={} message={:?}",
      report.state, report.found, report.message
    );
    for peer in discovery.handle().snapshot() {
      println!("    peer {} {:?}:{}", peer.name, peer.addresses, peer.port);
    }
  }
  println!("== parando");
  discovery.stop();
  println!("== fim");
}
