//! PoC E0a do sync P2P (S10/P2): dois aparelhos na mesma LAN se acham e
//! trocam `hello`. Sem UI e sem banco — é a prova da descoberta + transporte.
//!
//! Rode em dois terminais (mesma máquina ou máquinas na mesma Wi-Fi):
//!
//! ```text
//! cargo run --manifest-path src-tauri/Cargo.toml --example sync_poc -- \
//!   --identity /tmp/atlas-a.key --device-id dev-a
//! cargo run --manifest-path src-tauri/Cargo.toml --example sync_poc -- \
//!   --identity /tmp/atlas-b.key --device-id dev-b
//! ```
//!
//! O primeiro anúncio resolve em segundos; o de EndpointID menor disca, o outro
//! aceita. Cada lado loga o `device_id` do par — se aparecer nos dois, E0a
//! passou. No Windows, aceite o prompt do Firewall (UDP de entrada).

use std::collections::HashSet;
use std::path::PathBuf;

use app_lib::sync::{discovery, engine, identity};
use iroh::EndpointId;
use mdns_sd::ServiceEvent;
use tokio::sync::mpsc;

struct Args {
  identity: PathBuf,
  device_id: String,
  schema: u32,
}

fn parse_args() -> Args {
  let mut identity = std::env::temp_dir().join("atlas-identity.key");
  let mut device_id = "dev-poc".to_string();
  let mut schema = 6u32;
  let mut args = std::env::args().skip(1);
  while let Some(arg) = args.next() {
    match arg.as_str() {
      "--identity" => {
        if let Some(value) = args.next() {
          identity = PathBuf::from(value);
        }
      }
      "--device-id" => {
        if let Some(value) = args.next() {
          device_id = value;
        }
      }
      "--schema" => {
        if let Some(value) = args.next() {
          schema = value.parse().expect("--schema precisa ser número");
        }
      }
      "--help" | "-h" => {
        println!("uso: sync_poc [--identity <arquivo>] [--device-id <id>] [--schema <n>]");
        std::process::exit(0);
      }
      other => {
        eprintln!("argumento desconhecido: {other}");
        std::process::exit(2);
      }
    }
  }
  Args {
    identity,
    device_id,
    schema,
  }
}

#[tokio::main]
async fn main() {
  let args = parse_args();
  let key = identity::load_or_create(&args.identity).expect("identidade");
  let endpoint = engine::bind(key).await.expect("endpoint iroh");
  let me = endpoint.id();
  let local = engine::LocalNode {
    schema: args.schema,
    device_id: args.device_id.clone(),
  };

  let (_advertisement, receiver) = discovery::Advertisement::start(&endpoint).expect("anúncio DNS-SD");
  println!("[poc] endpoint {me}");
  println!("[poc] device_id  {}", args.device_id);
  println!("[poc] identity   {}", args.identity.display());
  println!("[poc] anunciando {} — Ctrl+C para sair", discovery::SERVICE_TYPE);

  // Aceita conexões em paralelo: um par por vez é suficiente para o PoC, mas
  // não bloqueia a descoberta.
  tokio::spawn({
    let endpoint = endpoint.clone();
    let local = local.clone();
    async move {
      loop {
        match engine::accept(&endpoint, &local).await {
          Ok(Some((remote, hello))) => println!(
            "[poc] hello de {remote} (device_id={}, schema={}, proto={})",
            hello.device_id, hello.schema, hello.proto
          ),
          Ok(None) => break,
          // Timeout é rotina: rearma o accept.
          Err(error) if error.contains("timeout no hello") => continue,
          Err(error) => eprintln!("[poc] accept falhou: {error}"),
        }
      }
    }
  });

  // O receiver do mdns-sd é bloqueante: bombeia para o runtime async.
  let (events_tx, mut events_rx) = mpsc::unbounded_channel();
  std::thread::spawn(move || {
    while let Ok(event) = receiver.recv() {
      if events_tx.send(event).is_err() {
        break;
      }
    }
  });

  let mut dialed: HashSet<EndpointId> = HashSet::new();
  while let Some(event) = events_rx.recv().await {
    let ServiceEvent::ServiceResolved(info) = event else {
      continue;
    };
    let Some(peer) = discovery::parse_resolved(&info) else {
      continue;
    };
    if peer.id == me {
      continue;
    }
    // Regra de quem disca: ID menor inicia. O outro só aceita.
    if me > peer.id {
      continue;
    }
    // O mDNS reanuncia periodicamente; não discar de novo para o mesmo par.
    if !dialed.insert(peer.id) {
      continue;
    }
    println!("[poc] descobri {} — discando", peer.id);
    let endpoint = endpoint.clone();
    let local = local.clone();
    tokio::spawn(async move {
      match engine::dial(&endpoint, peer.clone(), &local).await {
        Ok(hello) => println!(
          "[poc] hello de {} (device_id={}, schema={}, proto={})",
          peer.id, hello.device_id, hello.schema, hello.proto
        ),
        Err(error) => eprintln!("[poc] dial para {} falhou: {error}", peer.id),
      }
    });
  }
}
