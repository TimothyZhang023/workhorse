use tauri::{LogicalSize, Manager, Size, WebviewWindow};
use tauri_plugin_shell::ShellExt;

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

  window.set_size(Size::Logical(LogicalSize::new(
    target_width,
    target_height,
  )))?;
  window.center()?;
  window.show()?;
  window.set_focus()?;

  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }

      // Initialize shell plugin
      app.handle().plugin(tauri_plugin_shell::init())?;

      // Spawn Node.js sidecar
      let sidecar = app.shell()
          .sidecar("cowhouse-server")
          .expect("failed to create sidecar configuration");

      let (mut rx, _child) = sidecar.spawn()
          .expect("failed to spawn cowhouse-server sidecar");

      // Optional: log sidecar output
      tauri::async_runtime::spawn(async move {
          while let Some(event) = rx.recv().await {
              if let tauri_plugin_shell::process::CommandEvent::Stdout(line) = event {
                  println!("sidecar: {}", String::from_utf8_lossy(&line));
              } else if let tauri_plugin_shell::process::CommandEvent::Stderr(line) = event {
                  eprintln!("sidecar error: {}", String::from_utf8_lossy(&line));
              }
          }
      });

      if let Some(window) = app.get_webview_window("main") {
        fit_main_window(&window)?;
      }

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
