//! Sync P2P na LAN (S10/P2).
//!
//! Desktop e Android usam o mesmo mDNS (`mdns-sd`); no Android o socket
//! multicast só recebe com `MulticastLock` (plugin Kotlin). No iOS a
//! descoberta é o bridge Bonjour (P4), porque o mDNS cru é bloqueado por
//! entitlement — o protocolo e o merge não sabem quem descobriu o par.
//!
//! Decisões e protocolo: `docs/SYNC.md` §3.

pub mod commands;
#[cfg(not(target_os = "ios"))]
pub mod discovery;
#[cfg(target_os = "ios")]
pub mod discovery_ios;
pub mod engine;
pub mod pair;
pub mod identity;
pub mod protocol;
pub mod session;
pub mod store;
