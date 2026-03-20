use std::{
    fs,
    net::{SocketAddr, TcpStream},
    path::{Path, PathBuf},
    process::Command as StdCommand,
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalSize, Manager, RunEvent, Size, WebviewWindow};
use tauri_plugin_shell::{process::CommandChild, ShellExt};

const WORKHORSE_DOCUMENTS_DIR_NAME: &str = "workhorse";
const SIDECAR_RUNTIME_DIR_NAME: &str = "sidecar-runtime";
const EMBEDDED_RUNTIME_PARENT_DIR_NAME: &str = "runtime";
const RUNTIME_VERSION_FILE_NAME: &str = ".runtime-version";
const WORKHORSE_DEEP_LINK_SCHEME: &str = "workhorse://";

#[derive(Debug, Default)]
struct SidecarState {
    child: Mutex<Option<CommandChild>>,
    cleaned_up: AtomicBool,
}

#[derive(Debug, Clone, Serialize)]
struct BackendRuntimeStatus {
    status: String,
    message: Option<String>,
}

impl Default for BackendRuntimeStatus {
    fn default() -> Self {
        Self {
            status: "checking".into(),
            message: None,
        }
    }
}

#[derive(Debug, Default)]
struct BackendStatusState {
    current: Mutex<BackendRuntimeStatus>,
}

fn update_backend_status(app: &AppHandle, status: impl Into<String>, message: Option<String>) {
    let next = BackendRuntimeStatus {
        status: status.into(),
        message,
    };

    if let Ok(mut current) = app.state::<BackendStatusState>().current.lock() {
        *current = next;
    }
}

fn fit_main_window(window: &WebviewWindow) -> tauri::Result<()> {
    const DEFAULT_WIDTH: f64 = 1280.0;
    const DEFAULT_HEIGHT: f64 = 820.0;
    const MIN_WIDTH: f64 = 1100.0;
    const MIN_HEIGHT: f64 = 760.0;
    const TARGET_AREA_RATIO: f64 = 0.8;

    let mut target_width = DEFAULT_WIDTH;
    let mut target_height = DEFAULT_HEIGHT;

    if let Some(monitor) = window.current_monitor()? {
        let monitor_size = monitor.size().to_logical::<f64>(monitor.scale_factor());
        let edge_ratio = TARGET_AREA_RATIO.sqrt();
        let min_width = MIN_WIDTH.min(monitor_size.width);
        let min_height = MIN_HEIGHT.min(monitor_size.height);

        target_width = (monitor_size.width * edge_ratio)
            .max(min_width)
            .min(monitor_size.width);
        target_height = (monitor_size.height * edge_ratio)
            .max(min_height)
            .min(monitor_size.height);
    }

    window.set_size(Size::Logical(LogicalSize::new(target_width, target_height)))?;
    window.center()?;
    window.show()?;
    window.set_focus()?;

    Ok(())
}

fn project_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri should live under the project root")
        .to_path_buf()
}

fn workhorse_documents_dir(base_documents_dir: &Path) -> PathBuf {
    base_documents_dir.join(WORKHORSE_DOCUMENTS_DIR_NAME)
}

fn installed_sidecar_runtime_dir(workspace_root: &Path) -> PathBuf {
    workspace_root
        .join(EMBEDDED_RUNTIME_PARENT_DIR_NAME)
        .join(SIDECAR_RUNTIME_DIR_NAME)
}

fn bundled_sidecar_runtime_dir(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().resource_dir()?.join(SIDECAR_RUNTIME_DIR_NAME))
}

fn copy_dir_recursive(source: &Path, destination: &Path) -> tauri::Result<()> {
    fs::create_dir_all(destination)?;

    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let entry_type = entry.file_type()?;
        let source_path = entry.path();
        let destination_path = destination.join(entry.file_name());

        if entry_type.is_dir() {
            copy_dir_recursive(&source_path, &destination_path)?;
            continue;
        }

        if let Some(parent) = destination_path.parent() {
            fs::create_dir_all(parent)?;
        }
        fs::copy(&source_path, &destination_path)?;
    }

    Ok(())
}

#[cfg(unix)]
fn make_executable_if_exists(path: &Path) -> tauri::Result<()> {
    use std::os::unix::fs::PermissionsExt;

    if path.exists() {
        let mut permissions = fs::metadata(path)?.permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions)?;
    }

    Ok(())
}

#[cfg(not(unix))]
fn make_executable_if_exists(_path: &Path) -> tauri::Result<()> {
    Ok(())
}

fn sync_backend_runtime_to_documents(
    app: &AppHandle,
    workspace_root: &Path,
) -> tauri::Result<PathBuf> {
    let bundled_runtime_dir = bundled_sidecar_runtime_dir(app)?;
    let installed_runtime_dir = installed_sidecar_runtime_dir(workspace_root);
    let version_file_path = installed_runtime_dir.join(RUNTIME_VERSION_FILE_NAME);
    let expected_version = app.package_info().version.to_string();
    let launcher_name = if cfg!(target_os = "windows") {
        "workhorse-server.cmd"
    } else {
        "workhorse-server"
    };
    let launcher_path = installed_runtime_dir.join(launcher_name);

    let should_sync = fs::read_to_string(&version_file_path)
        .ok()
        .map(|value| value.trim().to_string())
        != Some(expected_version.clone())
        || !launcher_path.exists();

    if should_sync {
        if installed_runtime_dir.exists() {
            fs::remove_dir_all(&installed_runtime_dir)?;
        }

        copy_dir_recursive(&bundled_runtime_dir, &installed_runtime_dir)?;
        make_executable_if_exists(&installed_runtime_dir.join(launcher_name))?;
        make_executable_if_exists(&installed_runtime_dir.join("node"))?;
        fs::write(&version_file_path, format!("{expected_version}\n"))?;
    }

    Ok(installed_runtime_dir)
}

fn wait_for_backend_ready(port: u16, timeout: Duration) -> tauri::Result<()> {
    let deadline = Instant::now() + timeout;
    let address: SocketAddr = format!("127.0.0.1:{port}")
        .parse()
        .expect("invalid backend address");

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(500)).is_ok() {
            return Ok(());
        }

        thread::sleep(Duration::from_millis(250));
    }

    Err(tauri::Error::AssetNotFound(format!(
        "backend did not become ready on 127.0.0.1:{port}"
    )))
}

fn kill_ports(ports: &[u16]) {
    if !cfg!(debug_assertions) {
        return;
    }

    if ports.is_empty() {
        return;
    }

    let repo_root = project_root();
    let script_path = repo_root.join("scripts/killport.mjs");
    let node_binary = std::env::var("WORKHORSE_NODE_BIN").unwrap_or_else(|_| "node".into());
    let port_args = ports
        .iter()
        .map(|port| port.to_string())
        .collect::<Vec<_>>();

    match StdCommand::new(node_binary)
        .arg(script_path)
        .args(port_args)
        .current_dir(repo_root)
        .status()
    {
        Ok(status) if status.success() => {}
        Ok(status) => eprintln!("lifecycle cleanup: killport exited with status {status}"),
        Err(error) => eprintln!("lifecycle cleanup: failed to run killport script: {error}"),
    }
}

fn build_backend_sidecar(
    app: &AppHandle,
    workhorse_data_dir: &Option<PathBuf>,
) -> tauri::Result<tauri_plugin_shell::process::Command> {
    let documents_dir = app.path().document_dir()?;
    let workspace_root = workhorse_documents_dir(&documents_dir);
    fs::create_dir_all(&workspace_root)?;

    if cfg!(debug_assertions) {
        let repo_root = project_root();
        let server_entry = repo_root.join("server.js");
        let node_binary = std::env::var("WORKHORSE_NODE_BIN").unwrap_or_else(|_| "node".into());
        let mut command = app
            .shell()
            .command(node_binary)
            .args([server_entry.to_string_lossy().into_owned()])
            .current_dir(&workspace_root)
            .env("PORT", "12621")
            .env(
                "WORKHORSE_APP_DATA_DIR",
                workspace_root.to_string_lossy().to_string(),
            )
            .env(
                "WORKHORSE_WORKSPACE_ROOT",
                workspace_root.to_string_lossy().to_string(),
            )
            .env(
                "WORKHORSE_REPO_ROOT",
                repo_root.to_string_lossy().to_string(),
            );

        if let Some(dir) = workhorse_data_dir {
            command = command.env("WORKHORSE_DATA_DIR", dir.to_string_lossy().to_string());
        }

        return Ok(command);
    }

    let runtime_dir = sync_backend_runtime_to_documents(app, &workspace_root)?;
    let launcher_name = if cfg!(target_os = "windows") {
        "workhorse-server.cmd"
    } else {
        "workhorse-server"
    };
    let launcher_path = runtime_dir.join(launcher_name);

    let mut command = app
        .shell()
        .command(launcher_path.to_string_lossy().into_owned())
        .current_dir(&workspace_root)
        .env("PORT", "12621");

    if let Some(dir) = workhorse_data_dir {
        command = command.env("WORKHORSE_DATA_DIR", dir.to_string_lossy().to_string());
    }

    command = command
        .env(
            "WORKHORSE_APP_DATA_DIR",
            workspace_root.to_string_lossy().to_string(),
        )
        .env(
            "WORKHORSE_WORKSPACE_ROOT",
            workspace_root.to_string_lossy().to_string(),
        );

    Ok(command)
}

fn start_backend_sidecar(app: &AppHandle) -> tauri::Result<()> {
    update_backend_status(app, "starting", Some("starting backend sidecar".into()));

    let workhorse_data_dir = app
        .path()
        .home_dir()
        .ok()
        .map(|home| home.join(".workhorse"));
    if let Some(dir) = &workhorse_data_dir {
        fs::create_dir_all(dir)?;
        fs::create_dir_all(dir.join("tmp"))?;
    }

    let sidecar = build_backend_sidecar(app, &workhorse_data_dir)?;
    let (mut rx, child) = sidecar
        .spawn()
        .map_err(|error| tauri::Error::AssetNotFound(error.to_string()))?;

    app.state::<SidecarState>()
        .child
        .lock()
        .unwrap()
        .replace(child);
    app.state::<SidecarState>()
        .cleaned_up
        .store(false, Ordering::SeqCst);

    tauri::async_runtime::spawn(async move {
        while let Some(event) = rx.recv().await {
            match event {
                tauri_plugin_shell::process::CommandEvent::Stdout(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    let trimmed = line_str.trim_end();
                    if !trimmed.is_empty() {
                        println!("sidecar: {}", trimmed);
                    }
                }
                tauri_plugin_shell::process::CommandEvent::Stderr(line) => {
                    let line_str = String::from_utf8_lossy(&line);
                    let trimmed = line_str.trim_end();
                    if !trimmed.is_empty() {
                        eprintln!("sidecar error: {}", trimmed);
                    }
                }
                other => {
                    println!("sidecar event: {other:?}");
                }
            }
        }
    });

    if let Err(error) = wait_for_backend_ready(12621, Duration::from_secs(20)) {
        if let Some(child) = app.state::<SidecarState>().child.lock().unwrap().take() {
            let _ = child.kill();
        }
        update_backend_status(app, "degraded", Some(error.to_string()));
        return Err(error);
    }

    update_backend_status(app, "healthy", Some("backend sidecar is ready".into()));
    Ok(())
}

fn restart_backend_sidecar(app: &AppHandle) -> tauri::Result<()> {
    if let Some(child) = app.state::<SidecarState>().child.lock().unwrap().take() {
        let _ = child.kill();
    }

    kill_ports(&[12621]);
    start_backend_sidecar(app)
}

fn cleanup_runtime(app: &AppHandle) {
    let state = app.state::<SidecarState>();
    if state.cleaned_up.swap(true, Ordering::SeqCst) {
        return;
    }

    if let Some(child) = state.child.lock().unwrap().take() {
        if let Err(error) = child.kill() {
            eprintln!("lifecycle cleanup: failed to kill backend sidecar: {error}");
        }
    }

    kill_ports(&[12620, 12621]);
}

fn is_workhorse_deep_link(arg: &str) -> bool {
    arg.trim().starts_with(WORKHORSE_DEEP_LINK_SCHEME)
}

fn emit_deep_link_urls(app: &AppHandle, urls: Vec<String>) {
    if urls.is_empty() {
        return;
    }

    if let Some(window) = app.get_webview_window("main") {
        let _ = fit_main_window(&window);
    }

    let _ = app.emit("deep-link://new-url", urls);
}

#[tauri::command]
fn restart_backend(app: AppHandle) -> Result<(), String> {
    restart_backend_sidecar(&app).map_err(|error| format!("failed to restart backend: {error}"))
}

#[tauri::command]
fn get_backend_status(app: AppHandle) -> Result<BackendRuntimeStatus, String> {
    app.state::<BackendStatusState>()
        .current
        .lock()
        .map(|state| state.clone())
        .map_err(|error| format!("failed to read backend status: {error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(SidecarState::default())
        .manage(BackendStatusState::default())
        .invoke_handler(tauri::generate_handler![
            restart_backend,
            get_backend_status
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }

            app.handle().plugin(tauri_plugin_single_instance::init(
                |app, argv, _cwd| {
                    let urls = argv
                        .into_iter()
                        .filter(|arg| is_workhorse_deep_link(arg))
                        .collect::<Vec<_>>();
                    emit_deep_link_urls(app, urls);
                },
            ))?;
            app.handle().plugin(tauri_plugin_deep_link::init())?;
            app.handle().plugin(tauri_plugin_shell::init())?;
            if let Err(error) = start_backend_sidecar(&app.handle()) {
                let message = format!("backend startup failed: {error}");
                eprintln!("{message}");
                update_backend_status(&app.handle(), "degraded", Some(message));
            }

            if let Some(window) = app.get_webview_window("main") {
                fit_main_window(&window)?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            cleanup_runtime(app_handle);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_temp_dir(label: &str) -> PathBuf {
        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time should move forward")
            .as_millis();
        std::env::temp_dir().join(format!("workhorse-{label}-{}-{millis}", std::process::id()))
    }

    #[test]
    fn resolves_documents_workspace_and_runtime_paths() {
        let documents_dir = PathBuf::from("/tmp/Documents");
        let workspace_dir = workhorse_documents_dir(&documents_dir);

        assert_eq!(workspace_dir, PathBuf::from("/tmp/Documents/workhorse"));
        assert_eq!(
            installed_sidecar_runtime_dir(&workspace_dir),
            PathBuf::from("/tmp/Documents/workhorse/runtime/sidecar-runtime")
        );
    }

    #[test]
    fn copies_runtime_tree_recursively() {
        let source_root = unique_temp_dir("runtime-source");
        let target_root = unique_temp_dir("runtime-target");
        let nested_dir = source_root.join("nested");
        let nested_file = nested_dir.join("server.cjs");
        let root_file = source_root.join("workhorse-server");

        fs::create_dir_all(&nested_dir).expect("create nested source dir");
        fs::write(&nested_file, "console.log('ok');").expect("write nested file");
        fs::write(&root_file, "#!/bin/bash\necho ok\n").expect("write root file");

        copy_dir_recursive(&source_root, &target_root).expect("copy should succeed");

        assert_eq!(
            fs::read_to_string(target_root.join("nested/server.cjs")).expect("read nested file"),
            "console.log('ok');"
        );
        assert_eq!(
            fs::read_to_string(target_root.join("workhorse-server")).expect("read root file"),
            "#!/bin/bash\necho ok\n"
        );

        let _ = fs::remove_dir_all(&source_root);
        let _ = fs::remove_dir_all(&target_root);
    }
}
