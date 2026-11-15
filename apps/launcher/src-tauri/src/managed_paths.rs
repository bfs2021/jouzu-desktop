//! Where an installation keeps its files. Both binaries resolve this the same way, so the launcher's
//! console and a terminal entry read the same installation.

use std::path::PathBuf;

pub fn managed_root() -> Result<PathBuf, String> {
    // A development run keeps everything under the directory it names, so nothing it writes can be
    // mistaken for an installed state.
    #[cfg(debug_assertions)]
    if let Some(root) = std::env::var_os("JOUZU_LAUNCHER_DEV_HOME") {
        return Ok(PathBuf::from(root));
    }
    #[cfg(windows)]
    {
        let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
        return Ok(PathBuf::from(local).join("Shisa.ai").join("JouzuDesktop"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var_os("HOME").ok_or("HOME is unavailable")?;
        return Ok(PathBuf::from(home)
            .join("Library")
            .join("Application Support")
            .join("Shisa.ai")
            .join("JouzuDesktop"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = std::env::var_os("XDG_DATA_HOME")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".local").join("share")))
            .ok_or("HOME is unavailable")?;
        return Ok(base.join("Shisa.ai").join("JouzuDesktop"));
    }
}

/// The home Jouzu runs with. Desktop does not own Jouzu's data: sessions, settings and
/// credentials stay in Jouzu's own home, which `jz` uses too, and nothing is copied (#90).
/// That is the user's `JOUZU_HOME` when set, otherwise the home the installed runtime's
/// bootstrap defaults to (`packaging/launcher/bootstrap.mjs`). It does not depend on where
/// Desktop itself is installed.
pub fn effective_home() -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    if std::env::var_os("JOUZU_LAUNCHER_DEV_HOME").is_some() {
        return Ok(managed_root()?.join("data"));
    }
    if let Some(home) = std::env::var_os("JOUZU_HOME").filter(|value| !value.is_empty()) {
        return Ok(PathBuf::from(home));
    }
    jouzu_default_home()
}

/// Jouzu's default home, the same expression as the bootstrap's
/// `JOUZU_HOME ||= <LOCALAPPDATA>\Shisa.ai\Jouzu\data`.
#[cfg(windows)]
fn jouzu_default_home() -> Result<PathBuf, String> {
    let local = std::env::var_os("LOCALAPPDATA").ok_or("LOCALAPPDATA is unavailable")?;
    Ok(PathBuf::from(local).join("Shisa.ai").join("Jouzu").join("data"))
}

/// The bootstrap defines a default only on Windows, the one platform Desktop ships on;
/// elsewhere the home stays beside the installation.
#[cfg(not(windows))]
fn jouzu_default_home() -> Result<PathBuf, String> {
    Ok(managed_root()?.join("data"))
}
