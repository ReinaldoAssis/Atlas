//! Descoberta no iOS sobre o DNS-SD do sistema (`dns_sd.h`, em libSystem).
//!
//! O mDNS cru (socket multicast) exige o entitlement restrito
//! `com.apple.developer.networking.multicast`, que a Apple nega para mDNS
//! direto. `DNSServiceRegister`/`Browse`/`Resolve` passam pelo mDNSResponder e
//! só precisam da permissão de **Rede Local**
//! (`NSLocalNetworkUsageDescription` + `NSBonjourServices`).
//!
//! O `dns_sd` é C puro, então não há plugin Swift nem FFI de ida e volta: uma
//! thread faz `poll` nos sockets do DNS-SD e chama `DNSServiceProcessResult`,
//! que dispara os callbacks. O Rust lê o snapshot dela a cada segundo.

use std::collections::BTreeMap;
use std::ffi::{CStr, CString, c_char, c_int, c_void};
use std::net::Ipv4Addr;
use std::ptr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::{Deserialize, Serialize};

type ServiceRef = *mut c_void;
type ServiceFlags = u32;
type ServiceError = c_int;

const NO_ERROR: ServiceError = 0;
const FLAG_ADD: ServiceFlags = 0x2;
const SERVICE_TYPE: &str = "_atlas-sync._udp.";
const SERVICE_DOMAIN: &str = "local.";
/// Tempo do `poll`; também é o atraso máximo do `stop`.
const POLL_TIMEOUT_MS: c_int = 250;

type RegisterReply = extern "C" fn(
  ServiceRef,
  ServiceFlags,
  ServiceError,
  *const c_char,
  *const c_char,
  *const c_char,
  *mut c_void,
);
type BrowseReply = extern "C" fn(
  ServiceRef,
  ServiceFlags,
  ServiceError,
  *const c_char,
  *const c_char,
  *const c_char,
  *mut c_void,
);
type ResolveReply = extern "C" fn(
  ServiceRef,
  ServiceFlags,
  ServiceError,
  *const c_char,
  *const c_char,
  u16,
  u16,
  *const c_void,
  *mut c_void,
);

// Símbolos de libSystem (iOS/macOS). Declarados só onde são usados.
unsafe extern "C" {
  fn DNSServiceRegister(
    sd_ref: *mut ServiceRef,
    flags: ServiceFlags,
    interface_index: u32,
    name: *const c_char,
    regtype: *const c_char,
    domain: *const c_char,
    host: *const c_char,
    port: u16,
    txt_len: u16,
    txt_record: *const c_void,
    callback: Option<RegisterReply>,
    context: *mut c_void,
  ) -> ServiceError;
  fn DNSServiceBrowse(
    sd_ref: *mut ServiceRef,
    flags: ServiceFlags,
    interface_index: u32,
    regtype: *const c_char,
    domain: *const c_char,
    callback: Option<BrowseReply>,
    context: *mut c_void,
  ) -> ServiceError;
  fn DNSServiceResolve(
    sd_ref: *mut ServiceRef,
    flags: ServiceFlags,
    interface_index: u32,
    name: *const c_char,
    regtype: *const c_char,
    domain: *const c_char,
    callback: Option<ResolveReply>,
    context: *mut c_void,
  ) -> ServiceError;
  fn DNSServiceProcessResult(sd_ref: ServiceRef) -> ServiceError;
  fn DNSServiceRefSockFD(sd_ref: ServiceRef) -> c_int;
  fn DNSServiceRefDeallocate(sd_ref: ServiceRef);
}

/// Par descoberto (mesmo formato do `DiscoveredPeer` do desktop).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IosPeer {
  pub id: String,
  pub name: String,
  pub addresses: Vec<String>,
  pub port: u16,
}

#[derive(Debug, Clone)]
struct PendingService {
  name: String,
  regtype: String,
  domain: String,
}

#[derive(Debug, Default)]
struct State {
  self_id: String,
  alive: bool,
  peers: BTreeMap<String, IosPeer>,
  pending: Vec<PendingService>,
}

type Shared = Arc<Mutex<State>>;

/// Singleton de processo: callbacks C não carregam contexto do Rust.
static SHARED: Mutex<Option<Shared>> = Mutex::new(None);

fn shared() -> Option<Shared> {
  SHARED.lock().ok().and_then(|slot| slot.clone())
}

/// Handle de leitura usado pelo loop de descoberta.
#[derive(Clone)]
pub struct Handle {
  state: Shared,
}

impl Handle {
  pub fn snapshot(&self) -> Vec<IosPeer> {
    let Ok(state) = self.state.lock() else {
      return Vec::new();
    };
    state.peers.values().cloned().collect()
  }
}

/// Descoberta ativa: registro + browse + a thread que processa o DNS-SD.
pub struct Discovery {
  state: Shared,
  thread: Option<std::thread::JoinHandle<()>>,
}

impl Discovery {
  pub fn start(endpoint_id: &str, name: &str, port: u16) -> Result<Self, String> {
    stop_shared();
    let state: Shared = Arc::new(Mutex::new(State {
      self_id: endpoint_id.to_string(),
      alive: true,
      ..State::default()
    }));
    {
      let mut slot = SHARED.lock().map_err(|_| "descoberta iOS: lock".to_string())?;
      *slot = Some(state.clone());
    }

    let (ready_tx, ready_rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let instance = name.to_string();
    let thread = {
      let state = state.clone();
      std::thread::spawn(move || poll_loop(state, instance, port, ready_tx))
    };
    match ready_rx.recv() {
      Ok(Ok(())) => {}
      other => {
        set_alive(&state, false);
        let _ = thread.join();
        let message = match other {
          Ok(Err(error)) => error,
          _ => "descoberta iOS: thread não iniciou".to_string(),
        };
        return Err(message);
      }
    }
    Ok(Self {
      state,
      thread: Some(thread),
    })
  }

  pub fn handle(&self) -> Handle {
    Handle {
      state: self.state.clone(),
    }
  }

  pub fn stop(mut self) {
    set_alive(&self.state, false);
    if let Some(thread) = self.thread.take() {
      let _ = thread.join();
    }
    let mut slot = match SHARED.lock() {
      Ok(slot) => slot,
      Err(_) => return,
    };
    if slot.as_ref().is_some_and(|shared| Arc::ptr_eq(shared, &self.state)) {
      *slot = None;
    }
  }
}

fn stop_shared() {
  if let Some(state) = shared() {
    set_alive(&state, false);
    // A thread antiga percebe no próximo poll; o singleton já vai ser trocado.
  }
}

fn set_alive(state: &Shared, value: bool) {
  if let Ok(mut state) = state.lock() {
    state.alive = value;
  }
}

fn cstring(value: &str) -> CString {
  CString::new(value).unwrap_or_default()
}

/// Thread única: os sockets do DNS-SD só podem ser processados por um lugar.
fn poll_loop(
  state: Shared,
  name: String,
  port: u16,
  ready: std::sync::mpsc::Sender<Result<(), String>>,
) {
  let name_c = cstring(&name);
  let type_c = cstring(SERVICE_TYPE);
  let domain_c = cstring(SERVICE_DOMAIN);
  let self_id = state
    .lock()
    .map(|state| state.self_id.clone())
    .unwrap_or_default();
  let txt = txt_record(&[("id", &self_id), ("v", "1")]);

  let mut register: ServiceRef = ptr::null_mut();
  let error = unsafe {
    DNSServiceRegister(
      &mut register,
      0,
      0,
      name_c.as_ptr(),
      type_c.as_ptr(),
      domain_c.as_ptr(),
      ptr::null(),
      port.to_be(),
      txt.len() as u16,
      txt.as_ptr() as *const c_void,
      Some(on_register),
      ptr::null_mut(),
    )
  };
  if error != NO_ERROR || register.is_null() {
    let _ = ready.send(Err(format!("descoberta iOS: register falhou ({error})")));
    return;
  }

  let mut browse: ServiceRef = ptr::null_mut();
  let error = unsafe {
    DNSServiceBrowse(
      &mut browse,
      0,
      0,
      type_c.as_ptr(),
      domain_c.as_ptr(),
      Some(on_browse),
      ptr::null_mut(),
    )
  };
  if error != NO_ERROR || browse.is_null() {
    unsafe { DNSServiceRefDeallocate(register) };
    let _ = ready.send(Err(format!("descoberta iOS: browse falhou ({error})")));
    return;
  }
  let _ = ready.send(Ok(()));
  let mut refs: Vec<(ServiceRef, bool)> = vec![(register, false), (browse, false)];
  while state.lock().map(|state| state.alive).unwrap_or(false) {
    // Resolves pedidos pelos callbacks de browse.
    let pending = state
      .lock()
      .map(|mut state| std::mem::take(&mut state.pending))
      .unwrap_or_default();
    for service in pending {
      if let Some(reference) = start_resolve(&service) {
        refs.push((reference, true));
      }
    }
    if refs.is_empty() {
      break;
    }
    let mut fds: Vec<libc::pollfd> = refs
      .iter()
      .map(|(reference, _)| libc::pollfd {
        fd: unsafe { DNSServiceRefSockFD(*reference) },
        events: libc::POLLIN,
        revents: 0,
      })
      .collect();
    let ready = unsafe { libc::poll(fds.as_mut_ptr(), fds.len() as libc::nfds_t, POLL_TIMEOUT_MS) };
    if ready <= 0 {
      continue;
    }
    let mut index = 0;
    while index < refs.len() {
      let read_ready = fds[index].revents & libc::POLLIN != 0;
      if !read_ready {
        index += 1;
        continue;
      }
      let (reference, is_resolve) = refs[index];
      unsafe { DNSServiceProcessResult(reference) };
      if is_resolve {
        // O resolve entrega um único resultado.
        unsafe { DNSServiceRefDeallocate(reference) };
        refs.remove(index);
        fds.remove(index);
        continue;
      }
      index += 1;
    }
  }
  for (reference, _) in refs {
    unsafe { DNSServiceRefDeallocate(reference) };
  }
}

fn start_resolve(service: &PendingService) -> Option<ServiceRef> {
  let name = CString::new(service.name.clone()).ok()?;
  let regtype = CString::new(service.regtype.clone()).ok()?;
  let domain = CString::new(service.domain.clone()).ok()?;
  let mut reference: ServiceRef = ptr::null_mut();
  let error = unsafe {
    DNSServiceResolve(
      &mut reference,
      0,
      0,
      name.as_ptr(),
      regtype.as_ptr(),
      domain.as_ptr(),
      Some(on_resolve),
      ptr::null_mut(),
    )
  };
  (error == NO_ERROR && !reference.is_null()).then_some(reference)
}

extern "C" fn on_register(
  _reference: ServiceRef,
  _flags: ServiceFlags,
  _error: ServiceError,
  _name: *const c_char,
  _regtype: *const c_char,
  _domain: *const c_char,
  _context: *mut c_void,
) {
}

extern "C" fn on_browse(
  _reference: ServiceRef,
  flags: ServiceFlags,
  error: ServiceError,
  name: *const c_char,
  regtype: *const c_char,
  domain: *const c_char,
  _context: *mut c_void,
) {
  if error != NO_ERROR || name.is_null() || regtype.is_null() || domain.is_null() {
    return;
  }
  let name = unsafe { CStr::from_ptr(name) }.to_string_lossy().to_string();
  let regtype = unsafe { CStr::from_ptr(regtype) }.to_string_lossy().to_string();
  let domain = unsafe { CStr::from_ptr(domain) }.to_string_lossy().to_string();
  let Some(state) = shared() else { return };
  let Ok(mut state) = state.lock() else { return };
  if flags & FLAG_ADD != 0 {
    state.pending.push(PendingService {
      name,
      regtype,
      domain,
    });
  } else {
    state.peers.retain(|_, peer| peer.name != name);
  }
}

extern "C" fn on_resolve(
  _reference: ServiceRef,
  _flags: ServiceFlags,
  error: ServiceError,
  fullname: *const c_char,
  host: *const c_char,
  port: u16,
  txt_len: u16,
  txt_record: *const c_void,
  _context: *mut c_void,
) {
  if error != NO_ERROR || fullname.is_null() || host.is_null() {
    return;
  }
  let full = unsafe { CStr::from_ptr(fullname) }.to_string_lossy().to_string();
  let instance = full.split('.').next().unwrap_or_default().to_string();
  let host = unsafe { CStr::from_ptr(host) }.to_string_lossy().to_string();
  let port = u16::from_be(port);
  let id = txt_value(txt_record, txt_len, "id").unwrap_or_default();
  if id.is_empty() {
    return;
  }
  let addresses = resolve_addresses(&host);
  if addresses.is_empty() {
    return;
  }
  let Some(state) = shared() else { return };
  let Ok(mut state) = state.lock() else { return };
  if id == state.self_id {
    return;
  }
  state.peers.insert(
    id.clone(),
    IosPeer {
      id,
      name: instance,
      addresses,
      port,
    },
  );
}

/// TXT do DNS-SD: sequência de `<tamanho><chave=valor>`.
fn txt_record(values: &[(&str, &str)]) -> Vec<u8> {
  let mut bytes = Vec::new();
  for (key, value) in values {
    let entry = format!("{key}={value}").into_bytes();
    if entry.len() < 256 {
      bytes.push(entry.len() as u8);
      bytes.extend_from_slice(&entry);
    }
  }
  bytes
}

fn txt_value(record: *const c_void, len: u16, key: &str) -> Option<String> {
  if record.is_null() || len == 0 {
    return None;
  }
  let bytes = unsafe { std::slice::from_raw_parts(record as *const u8, len as usize) };
  let mut index = 0;
  while index < bytes.len() {
    let length = bytes[index] as usize;
    index += 1;
    if length == 0 || index + length > bytes.len() {
      break;
    }
    let entry = &bytes[index..index + length];
    index += length;
    if let Ok(text) = std::str::from_utf8(entry) {
      if let Some((entry_key, value)) = text.split_once('=') {
        if entry_key == key {
          return Some(value.to_string());
        }
      }
    }
  }
  None
}

/// IPv4 do host `.local` via mDNSResponder (`getaddrinfo` resolve `.local`).
fn resolve_addresses(host: &str) -> Vec<String> {
  let Ok(host) = CString::new(host) else {
    return Vec::new();
  };
  let mut hints: libc::addrinfo = unsafe { std::mem::zeroed() };
  hints.ai_family = libc::AF_INET;
  hints.ai_socktype = libc::SOCK_STREAM;
  let mut result: *mut libc::addrinfo = ptr::null_mut();
  let code = unsafe { libc::getaddrinfo(host.as_ptr(), ptr::null(), &hints, &mut result) };
  if code != 0 || result.is_null() {
    return Vec::new();
  }
  let mut addresses = Vec::new();
  let mut current = result;
  while !current.is_null() {
    unsafe {
      let info = &*current;
      if info.ai_family == libc::AF_INET && !info.ai_addr.is_null() {
        let address = &*(info.ai_addr as *const libc::sockaddr_in);
        let octets = address.sin_addr.s_addr.to_ne_bytes();
        let ip = Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]);
        let text = ip.to_string();
        if !addresses.contains(&text) {
          addresses.push(text);
        }
      }
      current = info.ai_next;
    }
  }
  unsafe { libc::freeaddrinfo(result) };
  addresses
}

/// Intervalo do polling do snapshot.
pub const POLL: Duration = Duration::from_secs(1);
