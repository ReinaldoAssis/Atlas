//! Sync P2P na LAN (S10/P2).
//!
//! Só desktop por enquanto: o iOS entra em P4 com o bridge Bonjour. O mDNS
//! cru (`mdns-sd`) é bloqueado no iPhone por entitlement, então a descoberta é
//! uma peça trocável — o protocolo e o merge não sabem quem descobriu o par.
//!
//! Decisões e protocolo: `docs/SYNC.md` §3.

pub mod commands;
pub mod discovery;
pub mod engine;
pub mod identity;
pub mod protocol;
pub mod session;
pub mod store;
