//! A QA installation shows the Jouzu icon with a "QA" badge, so it is never mistaken
//! for a stable one (issue #74).
//!
//! QA is the same build as stable (see `update_channel`), so the badge cannot be baked
//! into the executable. The icon is chosen at runtime from the channel: the window,
//! taskbar and tray get it at startup and whenever the channel changes, and on Windows
//! the Start menu, desktop and pinned shortcuts that start this executable point at the
//! QA icon file installed beside it (or back at the executable's own icon on stable).

use std::path::PathBuf;

use tauri::{image::Image, AppHandle, Manager};

use crate::update_channel::Channel;

pub const TRAY_ID: &str = "main";
const QA_ICON: &[u8] = include_bytes!("../icons/qa/icon.png");
/// Where the bundle installs the QA `.ico` (see `bundle.resources`).
pub const QA_ICO: &str = "icons/jouzu-qa.ico";

/// The icon this channel shows.
pub fn icon(app: &AppHandle, channel: Channel) -> Option<Image<'static>> {
    match channel {
        Channel::Qa => Image::from_bytes(QA_ICON).ok(),
        Channel::Stable => app.default_window_icon().map(|icon| icon.clone().to_owned()),
    }
}

/// Show this channel's icon on the window, the taskbar, the tray and the shortcuts.
pub fn apply(app: &AppHandle, channel: Channel) {
    if let Some(icon) = icon(app, channel) {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_icon(icon.clone());
        }
        if let Some(tray) = app.tray_by_id(TRAY_ID) {
            let _ = tray.set_icon(Some(icon));
        }
    }
    if let Ok(executable) = std::env::current_exe() {
        let qa_ico = crate::runtime::install_root_for_executable(&executable)
            .map(|root| root.join(QA_ICO))
            .ok();
        // Shortcut files are rewritten off the UI thread; a failure only leaves the old icon.
        std::thread::spawn(move || {
            let icon = match channel {
                Channel::Qa => qa_ico.filter(|path| path.is_file()),
                Channel::Stable => None,
            };
            shortcuts::point_at(&executable, icon.as_deref(), &shortcut_folders());
        });
    }
}

/// The folders the installer and Windows put shortcuts to this app in.
fn shortcut_folders() -> Vec<PathBuf> {
    let mut folders = Vec::new();
    if let Some(roaming) = std::env::var_os("APPDATA").map(PathBuf::from) {
        let programs = roaming.join(r"Microsoft\Windows\Start Menu\Programs");
        folders.push(programs.clone());
        if let Ok(entries) = std::fs::read_dir(&programs) {
            folders.extend(entries.flatten().map(|entry| entry.path()).filter(|path| path.is_dir()));
        }
        folders.push(roaming.join(r"Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar"));
    }
    if let Some(profile) = std::env::var_os("USERPROFILE").map(PathBuf::from) {
        folders.push(profile.join("Desktop"));
    }
    if let Some(desktop) = known_desktop() {
        folders.push(desktop);
    }
    folders.sort();
    folders.dedup();
    folders
}

#[cfg(windows)]
fn known_desktop() -> Option<PathBuf> {
    use windows::Win32::UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    // SAFETY: the returned string is owned by us and freed after it is copied.
    unsafe {
        let raw = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None).ok()?;
        let path = raw.to_string().ok().map(PathBuf::from);
        windows::Win32::System::Com::CoTaskMemFree(Some(raw.0 as _));
        path
    }
}

#[cfg(not(windows))]
fn known_desktop() -> Option<PathBuf> {
    None
}

#[cfg(windows)]
pub mod shortcuts {
    use std::path::{Path, PathBuf};

    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED, STGM_READWRITE,
    };
    use windows::Win32::UI::Shell::{
        IShellLinkW, SHChangeNotify, ShellLink, SHCNE_UPDATEITEM, SHCNF_PATHW,
    };

    /// Whether two paths name the same file. A shortcut stores its target in long form,
    /// while the same folder can reach us in 8.3 short form (`C:\Users\RUNNER~1\...`),
    /// so existing files are compared by their resolved path.
    pub(super) fn same_file(left: &Path, right: &Path) -> bool {
        if let (Ok(left), Ok(right)) = (std::fs::canonicalize(left), std::fs::canonicalize(right)) {
            return left == right;
        }
        let normal = |path: &Path| {
            let text = path.to_string_lossy().replace('/', "\\");
            text.trim_start_matches(r"\\?\").to_ascii_lowercase()
        };
        normal(left) == normal(right)
    }

    /// Point every `.lnk` in `folders` that starts `executable` at `icon`, or back at
    /// the executable's own icon when `icon` is `None`. Returns the shortcuts changed.
    pub fn point_at(executable: &Path, icon: Option<&Path>, folders: &[PathBuf]) -> Vec<PathBuf> {
        let mut changed = Vec::new();
        // SAFETY: COM is initialised for this thread and released at the end; every
        // interface is used only within it.
        unsafe {
            let initialised = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            for folder in folders {
                let Ok(entries) = std::fs::read_dir(folder) else { continue };
                for entry in entries.flatten() {
                    let path = entry.path();
                    if !path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("lnk")) {
                        continue;
                    }
                    if update(&path, executable, icon).unwrap_or(false) {
                        changed.push(path);
                    }
                }
            }
            if initialised {
                CoUninitialize();
            }
        }
        changed
    }

    unsafe fn update(shortcut: &Path, executable: &Path, icon: Option<&Path>) -> windows::core::Result<bool> {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        let file: IPersistFile = link.cast()?;
        let name = HSTRING::from(shortcut.as_os_str());
        file.Load(&name, STGM_READWRITE)?;
        let mut target = [0u16; 1024];
        link.GetPath(&mut target, std::ptr::null_mut(), 0)?;
        let length = target.iter().position(|&unit| unit == 0).unwrap_or(target.len());
        let target = PathBuf::from(String::from_utf16_lossy(&target[..length]));
        if !same_file(&target, executable) {
            return Ok(false);
        }
        let mut current = [0u16; 1024];
        let mut index = 0i32;
        let _ = link.GetIconLocation(&mut current, &mut index);
        let length = current.iter().position(|&unit| unit == 0).unwrap_or(current.len());
        let current = PathBuf::from(String::from_utf16_lossy(&current[..length]));
        // A shortcut the installer made has no icon location: it shows the executable's
        // own icon, which is already right for stable.
        if icon.is_none() && current.as_os_str().is_empty() {
            return Ok(false);
        }
        let wanted = icon.unwrap_or(executable);
        if same_file(&current, wanted) && index == 0 {
            return Ok(false);
        }
        link.SetIconLocation(&HSTRING::from(wanted.as_os_str()), 0)?;
        file.Save(PCWSTR::null(), true)?;
        SHChangeNotify(SHCNE_UPDATEITEM, SHCNF_PATHW, Some(name.as_ptr() as _), None);
        Ok(true)
    }
}

#[cfg(not(windows))]
pub mod shortcuts {
    use std::path::{Path, PathBuf};

    pub fn point_at(_executable: &Path, _icon: Option<&Path>, _folders: &[PathBuf]) -> Vec<PathBuf> {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_qa_icon_is_a_decodable_image_unlike_the_stable_one() {
        let qa = Image::from_bytes(QA_ICON).expect("QA icon decodes");
        assert!(qa.width() >= 128 && qa.width() == qa.height());
        let stable = Image::from_bytes(include_bytes!("../icons/icon.png")).unwrap();
        assert_ne!(qa.rgba(), stable.rgba());
    }

    /// A path in 8.3 short form names the same file as its long form (CI temp folders
    /// are under `RUNNER~1`).
    #[cfg(windows)]
    #[test]
    fn a_short_path_is_the_same_file_as_its_long_path() {
        use windows::core::HSTRING;
        use windows::Win32::Storage::FileSystem::GetShortPathNameW;
        let folder = tempfile::tempdir().unwrap();
        let long = folder.path().join("a long folder name").join("jouzu-desktop.exe");
        std::fs::create_dir_all(long.parent().unwrap()).unwrap();
        std::fs::write(&long, b"").unwrap();
        let mut buffer = [0u16; 1024];
        let length = unsafe { GetShortPathNameW(&HSTRING::from(long.as_os_str()), Some(&mut buffer)) } as usize;
        let short = PathBuf::from(String::from_utf16_lossy(&buffer[..length]));
        assert!(shortcuts::same_file(&long, &short), "{} vs {}", long.display(), short.display());
        assert!(!shortcuts::same_file(&long, &folder.path().join("other.exe")));
    }

    /// The `.lnk` round trip on a real shortcut: QA points it at the QA icon, stable
    /// points it back at the executable, and shortcuts to other programs are left alone.
    #[cfg(windows)]
    #[test]
    fn shortcuts_to_this_executable_follow_the_channel() {
        use std::path::Path;
        use windows::core::{Interface, HSTRING};
        use windows::Win32::System::Com::*;
        use windows::Win32::UI::Shell::*;

        let folder = tempfile::tempdir().unwrap();
        let executable = folder.path().join("jouzu-desktop.exe");
        let other = folder.path().join("other.exe");
        std::fs::write(&executable, b"").unwrap();
        std::fs::write(&other, b"").unwrap();
        let qa = folder.path().join("jouzu-qa.ico");
        std::fs::write(&qa, b"").unwrap();
        let create = |name: &str, target: &Path| unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).unwrap();
            link.SetPath(&HSTRING::from(target.as_os_str())).unwrap();
            let file: IPersistFile = link.cast().unwrap();
            let path = folder.path().join(name);
            file.Save(&HSTRING::from(path.as_os_str()), true).unwrap();
            path
        };
        let ours = create("Jouzu Desktop.lnk", &executable);
        let theirs = create("Other.lnk", &other);
        let folders = vec![folder.path().to_path_buf()];

        // Stable leaves the installer's shortcuts as they are.
        assert!(shortcuts::point_at(&executable, None, &folders).is_empty());
        let changed = shortcuts::point_at(&executable, Some(&qa), &folders);
        assert_eq!(changed, vec![ours.clone()]);
        assert!(!changed.contains(&theirs));
        // Already pointing at the QA icon: nothing to rewrite.
        assert!(shortcuts::point_at(&executable, Some(&qa), &folders).is_empty());
        // Back to stable.
        assert_eq!(shortcuts::point_at(&executable, None, &folders), vec![ours]);
    }
}
