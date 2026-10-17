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
/// `kDNSServiceErr_PolicyDenied`: o iOS recusou por falta da permissão de Rede
/// Local (o usuário negou o prompt ou desligou em Ajustes).
const POLICY_DENIED: ServiceError = -65570;

type RegisterReply = extern "C" fn(
  ServiceRef,
  ServiceFlags,
  ServiceError,
  *const c_char,
  *const c_char,
  *const c_char,
  *mut c_void,
);
/// ABI de `DNSServiceBrowseReply`: `interfaceIndex` vem **antes** do
/// `errorCode`. Sem ele todos os argumentos deslocam uma casa (o índice é lido
/// como erro e o nome vira o erro), e nenhum evento é processado.
type BrowseReply = extern "C" fn(
  ServiceRef,
  ServiceFlags,
  u32,
  ServiceError,
  *const c_char,
  *const c_char,
  *const c_char,
  *mut c_void,
);
/// ABI de `DNSServiceResolveReply`: mesma ordem do browse, com `interfaceIndex`
/// logo depois de `flags`.
type ResolveReply = extern "C" fn(
  ServiceRef,
  ServiceFlags,
  u32,
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
  /// Interface que o browse reportou; o resolve precisa consultar a mesma.
  interface_index: u32,
}

/// Tipo do `DNSServiceRef` no `poll`: register/browse são permanentes, resolve
/// entrega um resultado e é descartado.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum RefKind {
  Register,
  Browse,
  Resolve,
}

impl RefKind {
  fn label(self) -> &'static str {
    match self {
      Self::Register => "register",
      Self::Browse => "browse",
      Self::Resolve => "resolve",
    }
  }
}

#[derive(Debug, Default)]
struct State {
  self_id: String,
  alive: bool,
  registered: bool,
  browsing: bool,
  peers: BTreeMap<String, IosPeer>,
  pending: Vec<PendingService>,
  last_error: Option<DiscoveryError>,
}

#[derive(Debug, Clone)]
struct DiscoveryError {
  code: ServiceError,
  message: String,
}

/// Estado legível da descoberta para o `sync_status` (UI de Configurações).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IosReport {
  /// `off` | `starting` | `announcing` | `browsing` | `permission` | `error`.
  pub state: String,
  pub found: usize,
  pub message: Option<String>,
}

type Shared = Arc<Mutex<State>>;

/// Singleton de processo: callbacks C não carregam contexto do Rust.
static SHARED: Mutex<Option<Shared>> = Mutex::new(None);

fn shared() -> Option<Shared> {
  SHARED.lock().ok().and_then(|slot| slot.clone())
}

/// Último estado, mesmo quando `Discovery::start` falhou (o objeto não existe).
pub fn last_report() -> Option<IosReport> {
  shared().map(|state| Handle { state }.report())
}

/// Traduz o erro do DNS-SD para algo acionável na UI.
fn describe_error(code: ServiceError) -> String {
  if code == POLICY_DENIED {
    "Rede Local negada pelo iOS. Ative em Ajustes › Apps › Atlas › Rede Local.".to_string()
  } else {
    format!("DNS-SD retornou o erro {code}.")
  }
}

fn record_error(state: &Shared, call_site: &str, code: ServiceError) {
  record_error_detail(state, call_site, code, "");
}

fn record_error_detail(state: &Shared, call_site: &str, code: ServiceError, hint: &str) {
  if code == NO_ERROR {
    return;
  }
  let message = format!("{call_site}: {}{hint}", describe_error(code));
  log::warn!("descoberta iOS: {message}");
  if let Ok(mut state) = state.lock() {
    state.last_error = Some(DiscoveryError { code, message });
  }
}

fn record_error_message(state: &Shared, message: String) {
  log::warn!("descoberta iOS: {message}");
  if let Ok(mut state) = state.lock() {
    state.last_error = Some(DiscoveryError { code: -1, message });
  }
}

fn clear_error(state: &Shared) {
  if let Ok(mut state) = state.lock() {
    state.last_error = None;
  }
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

  pub fn report(&self) -> IosReport {
    let Ok(state) = self.state.lock() else {
      return IosReport {
        state: "error".to_string(),
        found: 0,
        message: Some("descoberta iOS: lock envenenado".to_string()),
      };
    };
    let found = state.peers.len();
    if !state.alive {
      return IosReport {
        state: "off".to_string(),
        found,
        message: None,
      };
    }
    if let Some(error) = &state.last_error {
      return IosReport {
        state: if error.code == POLICY_DENIED {
          "permission".to_string()
        } else {
          "error".to_string()
        },
        found,
        message: Some(error.message.clone()),
      };
    }
    IosReport {
      state: if state.browsing {
        "browsing".to_string()
      } else if state.registered {
        "announcing".to_string()
      } else {
        "starting".to_string()
      },
      found,
      message: None,
    }
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

  pub fn report(&self) -> IosReport {
    self.handle().report()
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
    record_error(&state, "register", error);
    let _ = ready.send(Err(format!("descoberta iOS: {}", describe_error(error))));
    return;
  }
  if let Ok(mut state) = state.lock() {
    state.registered = true;
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
    record_error(&state, "browse", error);
    let _ = ready.send(Err(format!("descoberta iOS: {}", describe_error(error))));
    return;
  }
  if let Ok(mut state) = state.lock() {
    state.browsing = true;
  }
  let _ = ready.send(Ok(()));
  let mut refs: Vec<(ServiceRef, RefKind)> =
    vec![(register, RefKind::Register), (browse, RefKind::Browse)];
  'poll: while state.lock().map(|state| state.alive).unwrap_or(false) {
    // Resolves pedidos pelos callbacks de browse.
    let pending = state
      .lock()
      .map(|mut state| std::mem::take(&mut state.pending))
      .unwrap_or_default();
    for service in pending {
      if let Some(reference) = start_resolve(&service, &state) {
        refs.push((reference, RefKind::Resolve));
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
    if ready < 0 {
      let error = std::io::Error::last_os_error();
      // EINTR é sinal, não falha: repetir sem sujar o log.
      if error.kind() != std::io::ErrorKind::Interrupted {
        record_error_message(&state, format!("poll falhou: {error}"));
      }
      continue;
    }
    if ready == 0 {
      continue;
    }
    let mut index = 0;
    while index < refs.len() {
      let read_ready = fds[index].revents & libc::POLLIN != 0;
      if !read_ready {
        index += 1;
        continue;
      }
      let (reference, kind) = refs[index];
      let code = unsafe { DNSServiceProcessResult(reference) };
      if code != NO_ERROR {
        // O stub do mDNSResponder zera o `ProcessReply` depois de uma falha de
        // leitura: o fd continua "legível" e cada poll devolve o mesmo erro.
        // Sem desalocar, o loop gira em falso para sempre e enche o log.
        unsafe { DNSServiceRefDeallocate(reference) };
        refs.remove(index);
        fds.remove(index);
        match kind {
          RefKind::Resolve => {
            record_error(&state, "resolve", code);
            continue;
          }
          RefKind::Register | RefKind::Browse => {
            record_error_detail(
              &state,
              kind.label(),
              code,
              " Descoberta interrompida; reinicie a descoberta.",
            );
            if let Ok(mut state) = state.lock() {
              match kind {
                RefKind::Register => state.registered = false,
                RefKind::Browse => state.browsing = false,
                RefKind::Resolve => {}
              }
            }
            break 'poll;
          }
        }
      }
      if kind == RefKind::Resolve {
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

fn start_resolve(service: &PendingService, state: &Shared) -> Option<ServiceRef> {
  let name = CString::new(service.name.clone()).ok()?;
  let regtype = CString::new(service.regtype.clone()).ok()?;
  let domain = CString::new(service.domain.clone()).ok()?;
  let mut reference: ServiceRef = ptr::null_mut();
  let error = unsafe {
    DNSServiceResolve(
      &mut reference,
      0,
      service.interface_index,
      name.as_ptr(),
      regtype.as_ptr(),
      domain.as_ptr(),
      Some(on_resolve),
      ptr::null_mut(),
    )
  };
  if error != NO_ERROR {
    record_error(state, "resolve", error);
    return None;
  }
  (!reference.is_null()).then_some(reference)
}

extern "C" fn on_register(
  _reference: ServiceRef,
  _flags: ServiceFlags,
  error: ServiceError,
  _name: *const c_char,
  _regtype: *const c_char,
  _domain: *const c_char,
  _context: *mut c_void,
) {
  if error != NO_ERROR {
    if let Some(state) = shared() {
      record_error(&state, "register", error);
    }
    return;
  }
  if let Some(state) = shared() {
    if let Ok(mut state) = state.lock() {
      state.registered = true;
    }
  }
}

extern "C" fn on_browse(
  _reference: ServiceRef,
  flags: ServiceFlags,
  interface_index: u32,
  error: ServiceError,
  name: *const c_char,
  regtype: *const c_char,
  domain: *const c_char,
  _context: *mut c_void,
) {
  if error != NO_ERROR || name.is_null() || regtype.is_null() || domain.is_null() {
    if error != NO_ERROR {
      if let Some(state) = shared() {
        record_error(&state, "browse", error);
      }
    }
    return;
  }
  let name = unescape(&unsafe { CStr::from_ptr(name) }.to_string_lossy());
  let regtype = unsafe { CStr::from_ptr(regtype) }.to_string_lossy().to_string();
  let domain = unsafe { CStr::from_ptr(domain) }.to_string_lossy().to_string();
  let Some(state) = shared() else { return };
  clear_error(&state);
  let Ok(mut state) = state.lock() else { return };
  state.browsing = true;
  if flags & FLAG_ADD != 0 {
    state.pending.push(PendingService {
      name,
      regtype,
      domain,
      interface_index,
    });
  } else {
    state.peers.retain(|_, peer| peer.name != name);
  }
}

extern "C" fn on_resolve(
  _reference: ServiceRef,
  _flags: ServiceFlags,
  _interface_index: u32,
  error: ServiceError,
  fullname: *const c_char,
  host: *const c_char,
  port: u16,
  txt_len: u16,
  txt_record: *const c_void,
  _context: *mut c_void,
) {
  if error != NO_ERROR || fullname.is_null() || host.is_null() {
    if error != NO_ERROR {
      if let Some(state) = shared() {
        record_error(&state, "resolve", error);
      }
    }
    return;
  }
  let full = unsafe { CStr::from_ptr(fullname) }.to_string_lossy().to_string();
  let instance = unescape(instance_label(&full));
  let host = unsafe { CStr::from_ptr(host) }.to_string_lossy().to_string();
  let port = u16::from_be(port);
  let id = txt_value(txt_record, txt_len, "id").unwrap_or_default();
  if id.is_empty() {
    return;
  }
  let Some(state) = shared() else { return };
  let addresses = match resolve_addresses(&host) {
    Ok(addresses) => addresses,
    Err(code) => {
      record_error_message(
        &state,
        format!("não resolveu {host} (getaddrinfo {code})."),
      );
      return;
    }
  };
  if addresses.is_empty() {
    record_error_message(&state, format!("{host} não devolveu nenhum IPv4."));
    return;
  }
  clear_error(&state);
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

/// Primeiro label do `fullname` (até o primeiro `.` não escapado).
fn instance_label(fullname: &str) -> &str {
  let bytes = fullname.as_bytes();
  let mut index = 0;
  while index < bytes.len() {
    match bytes[index] {
      b'\\' => index += 2,
      b'.' => return &fullname[..index],
      _ => index += 1,
    }
  }
  fullname
}

/// Desfaz os escapes `\DDD` que o DNS-SD usa nos labels (ex.: `\032` = espaço).
fn unescape(value: &str) -> String {
  let raw = value.as_bytes();
  let mut bytes = Vec::with_capacity(raw.len());
  let mut index = 0;
  while index < raw.len() {
    if raw[index] == b'\\' && index + 3 < raw.len() {
      let digits = &raw[index + 1..index + 4];
      if digits.iter().all(u8::is_ascii_digit) {
        let text = std::str::from_utf8(digits).unwrap_or_default();
        if let Ok(code) = text.parse::<u8>() {
          bytes.push(code);
          index += 4;
          continue;
        }
      }
    }
    bytes.push(raw[index]);
    index += 1;
  }
  String::from_utf8_lossy(&bytes).into_owned()
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
fn resolve_addresses(host: &str) -> Result<Vec<String>, i32> {
  let Ok(host) = CString::new(host) else {
    return Err(-1);
  };
  let mut hints: libc::addrinfo = unsafe { std::mem::zeroed() };
  hints.ai_family = libc::AF_INET;
  hints.ai_socktype = libc::SOCK_STREAM;
  let mut result: *mut libc::addrinfo = ptr::null_mut();
  let code = unsafe { libc::getaddrinfo(host.as_ptr(), ptr::null(), &hints, &mut result) };
  if code != 0 || result.is_null() {
    return Err(code);
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
  Ok(addresses)
}

/// Intervalo do polling do snapshot.
pub const POLL: Duration = Duration::from_secs(1);
