use std::{env, fs, path::PathBuf};

#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;

fn normalize_sidecar_runtime() {
    let sidecar_dir = PathBuf::from("sidecar-runtime");

    #[cfg(unix)]
    if let Ok(entries) = fs::read_dir(&sidecar_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) == Some("dylib") {
                let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o644));
            }
        }
    }

    if let Ok(out_dir) = env::var("OUT_DIR") {
        let out_dir = PathBuf::from(out_dir);
        if let Some(target_dir) = out_dir
            .parent()
            .and_then(|path| path.parent())
            .and_then(|path| path.parent())
        {
            let _ = fs::remove_dir_all(target_dir.join("sidecar-runtime"));
        }
    }
}

fn main() {
    normalize_sidecar_runtime();
    tauri_build::build()
}
