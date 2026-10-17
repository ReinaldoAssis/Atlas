//! Identidade do endpoint (chave Ed25519).
//!
//! A chave vive em `<appdata>/atlas-identity.key` (32 bytes, 0600), **fora** do
//! banco e do backup: reinstalar o app gera nova identidade e exige re-parear.
//! O EndpointID (chave pública) é o que a allowlist de pares usa.

use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use iroh::SecretKey;

pub const IDENTITY_FILE: &str = "atlas-identity.key";

/// Caminho da chave de identidade dentro do diretório de dados do app.
pub fn identity_path(app_dir: &Path) -> PathBuf {
  app_dir.join(IDENTITY_FILE)
}

/// Carrega a chave; cria na primeira execução.
///
/// Arquivo inválido é erro, **não** sobrescrita: gerar outra chave derrubaria
/// todos os pareamentos sem aviso.
pub fn load_or_create(path: &Path) -> io::Result<SecretKey> {
  match fs::read(path) {
    Ok(bytes) => {
      let array: [u8; 32] = bytes.as_slice().try_into().map_err(|_| {
        io::Error::new(
          io::ErrorKind::InvalidData,
          format!("{IDENTITY_FILE}: esperado 32 bytes, veio {}", bytes.len()),
        )
      })?;
      Ok(SecretKey::from_bytes(&array))
    }
    Err(error) if error.kind() == io::ErrorKind::NotFound => {
      let key = SecretKey::generate();
      write_key(path, &key)?;
      Ok(key)
    }
    Err(error) => Err(error),
  }
}

/// Grava a chave de forma atômica e restrita (0600).
fn write_key(path: &Path, key: &SecretKey) -> io::Result<()> {
  if let Some(parent) = path.parent() {
    fs::create_dir_all(parent)?;
  }
  let tmp = path.with_extension("key.tmp");
  {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
      use std::os::unix::fs::OpenOptionsExt;
      options.mode(0o600);
    }
    let mut file = options.open(&tmp)?;
    file.write_all(&key.to_bytes())?;
    file.sync_all()?;
  }
  #[cfg(unix)]
  {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(&tmp, fs::Permissions::from_mode(0o600))?;
  }
  fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
  use super::*;

  fn temp_dir(tag: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .unwrap()
      .as_nanos();
    let dir = std::env::temp_dir().join(format!("atlas-identity-{tag}-{stamp}"));
    fs::create_dir_all(&dir).unwrap();
    dir
  }

  #[test]
  fn creates_then_reloads_same_key() {
    let dir = temp_dir("reload");
    let path = identity_path(&dir);
    let first = load_or_create(&path).unwrap();
    let second = load_or_create(&path).unwrap();
    assert_eq!(first.public(), second.public());
    assert_eq!(fs::read(&path).unwrap().len(), 32);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[cfg(unix)]
  #[test]
  fn key_file_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let dir = temp_dir("perms");
    let path = identity_path(&dir);
    load_or_create(&path).unwrap();
    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    fs::remove_dir_all(&dir).unwrap();
  }

  #[test]
  fn corrupt_file_is_an_error_not_a_rotation() {
    let dir = temp_dir("corrupt");
    let path = identity_path(&dir);
    fs::write(&path, b"short").unwrap();
    let error = load_or_create(&path).unwrap_err();
    assert_eq!(error.kind(), io::ErrorKind::InvalidData);
    // O arquivo original continua lá: nada de girar identidade por engano.
    assert_eq!(fs::read(&path).unwrap(), b"short");
    fs::remove_dir_all(&dir).unwrap();
  }
}
