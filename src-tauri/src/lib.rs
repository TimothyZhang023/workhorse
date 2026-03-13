use tauri_plugin_shell::ShellExt;
use tauri::Manager;

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

      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
