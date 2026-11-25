//! Нативная оболочка Амадеуса.
//!
//! Команды ниже — заглушки с тем же контрактом, что и HTTP-зеркало в
//! `backend/core/app.py`. HTTP-зеркало доступно и из браузера, и из оболочки.
//! Фронтенд говорит с ядром по HTTP; invoke() используется только для нативных команд.

use base64::Engine;
use serde_json::{json, Value};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::Mutex;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;

/// Дочерний процесс ядра: собранный sidecar или Python из исходников в dev.
enum BackendChild {
    Native(std::process::Child),
    Sidecar(tauri_plugin_shell::process::CommandChild),
}

impl BackendChild {
    fn stop(self) {
        match self {
            Self::Native(mut child) => {
                let _ = child.kill();
                let _ = child.wait();
            }
            Self::Sidecar(child) => {
                let _ = child.kill();
            }
        }
    }
}

/// Дочерний процесс ядра; убивается при выходе приложения.
struct SidecarState(Mutex<Option<BackendChild>>);

fn backend_port_open() -> bool {
    ("127.0.0.1", 8787)
        .to_socket_addrs()
        .ok()
        .and_then(|mut addrs| addrs.next())
        .and_then(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(200)).ok())
        .is_some()
}

/// Поднимает ядро: в релизе — собранный externalBin, в dev — системный Python
/// с исходниками рядом с src-tauri (см. tauri.conf.json).
#[tauri::command]
fn start_backend(app: tauri::AppHandle, state: tauri::State<SidecarState>) -> Result<String, String> {
    if backend_port_open() {
        return Ok("ядро уже отвечает на :8787".into());
    }
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(data_dir.join("data")).map_err(|e| e.to_string())?;
    let db_path = data_dir.join("data/amadeus.db");

    // В релизе ядро — отдельный exe (externalBin), системный Python не нужен.
    // Если exe отсутствует или не запустился, тихо уходим в dev-fallback.
    let spawned = app
        .shell()
        .sidecar("amadeus-core")
        .ok()
        .and_then(|sidecar| {
            sidecar
                .env("AMADEUS_DB_PATH", &db_path)
                .env("AMADEUS_SECRET_STORE", "keyring")
                .env("AMADEUS_PORT", "8787")
                .spawn()
                .ok()
        });
    if let Some((mut rx, child)) = spawned {
        // Канал вывода нельзя выбрасывать: ядро может заблокироваться на записи в stdout.
        let log_path = data_dir.join("logs/core.log");
        if let Some(parent) = log_path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                let line = match event {
                    CommandEvent::Stdout(bytes) => format!("[out] {}", String::from_utf8_lossy(&bytes)),
                    CommandEvent::Stderr(bytes) => format!("[err] {}", String::from_utf8_lossy(&bytes)),
                    CommandEvent::Error(message) => format!("[error] {message}"),
                    CommandEvent::Terminated(_) => break,
                    _ => continue,
                };
                if let Ok(mut file) = std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    use std::io::Write;
                    let _ = writeln!(file, "{}", line.trim_end());
                }
            }
        });
        *state.0.lock().map_err(|e| e.to_string())? = Some(BackendChild::Sidecar(child));
        return Ok("ядро запущено из externalBin".into());
    }

    // В dev-режиме fallback на исходники и системный Python.
    let dev_dir = std::env::current_dir()
        .unwrap_or_default()
        .parent()
        .map(|p| p.join("backend"))
        .unwrap_or_default();
    if !dev_dir.join("core/app.py").exists() {
        return Err("не найдено ядро backend/core/app.py".into());
    }
    let python = std::env::var("AMADEUS_PYTHON").unwrap_or_else(|_| "python".into());
    let child = std::process::Command::new(python)
        .args([
            "-m", "uvicorn", "core.app:app",
            "--host", "127.0.0.1", "--port", "8787",
        ])
        .current_dir(&dev_dir)
        .env("AMADEUS_DB_PATH", db_path)
        .env("AMADEUS_SECRET_STORE", "keyring")
        .spawn()
        .map_err(|e| format!("не удалось запустить Python: {e}"))?;
    let pid = child.id();
    *state.0.lock().map_err(|e| e.to_string())? = Some(BackendChild::Native(child));
    Ok(format!("sidecar pid {pid}"))
}

#[tauri::command]
fn app_health() -> Value {
    json!({ "status": "ok", "shell": "tauri", "version": "0.1.0" })
}

/// Нативное уведомление ОС: вызывается при срабатывании напоминания и действии notify.
#[tauri::command]
fn notify_os(app: tauri::AppHandle, title: String, body: String) -> Result<(), String> {
    use tauri_plugin_notification::NotificationExt;
    app.notification()
        .builder()
        .title(title)
        .body(body)
        .show()
        .map_err(|error| error.to_string())
}

/// Снимок основного монитора в base64 PNG — уходит в ядро как обычное вложение.
#[tauri::command]
fn capture_screen_base64(app: tauri::AppHandle) -> Result<String, String> {
    let monitors = xcap::Monitor::all().map_err(|error| error.to_string())?;
    let monitor = monitors.first().ok_or("монитор не найден")?;
    let image = monitor.capture_image().map_err(|error| error.to_string())?;

    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("screenshots");
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    let path = dir.join(format!("screen-{stamp}.png"));
    image.save(&path).map_err(|error| error.to_string())?;
    let bytes = std::fs::read(&path).map_err(|error| error.to_string())?;
    Ok(base64::engine::general_purpose::STANDARD.encode(bytes))
}

#[tauri::command]
fn window_hide(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

#[tauri::command]
fn window_show(app: tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// Полноэкранный режим для сцены «Сфера».
#[tauri::command]
fn window_fullscreen(app: tauri::AppHandle, enabled: bool) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_fullscreen(enabled);
    }
}

/// Свёрнутый режим: окно без рамки и тени, поверх всех, только сфера в правом нижнем углу.
#[tauri::command]
fn window_mini(app: tauri::AppHandle, enabled: bool) {
    let Some(window) = app.get_webview_window("main") else { return };
    if enabled {
        let (w, h) = (280.0_f64, 320.0_f64);
        let _ = window.set_fullscreen(false);
        let _ = window.set_decorations(false);
        let _ = window.set_shadow(false);
        let _ = window.set_min_size(None::<tauri::Size>);
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h }));
        let _ = window.set_always_on_top(true);
        let _ = window.set_skip_taskbar(true);
        if let Ok(Some(monitor)) = window.current_monitor() {
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let pos = monitor.position();
            let x = pos.x + size.width as i32 - ((w + 24.0) * scale) as i32;
            let y = pos.y + size.height as i32 - ((h + 56.0) * scale) as i32;
            let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
        }
    } else {
        let _ = window.set_always_on_top(false);
        let _ = window.set_skip_taskbar(false);
        let _ = window.set_decorations(true);
        let _ = window.set_shadow(true);
        let _ = window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize { width: 900.0, height: 600.0 })));
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1440.0, height: 900.0 }));
        let _ = window.center();
    }
    let _ = window.show();
}

macro_rules! stub {
    ($name:ident) => {
        #[tauri::command]
        fn $name() -> Result<Value, String> {
            Err(format!("NOT_IMPLEMENTED: {}", stringify!($name)))
        }
    };
}

stub!(setup_status);
stub!(setup_complete);
stub!(settings_get);
stub!(settings_patch);
stub!(settings_locale);
stub!(credentials_set);
stub!(credentials_test);
stub!(providers_list);
stub!(providers_upsert);
stub!(providers_apply);
stub!(conversations_list);
stub!(conversations_create);
stub!(conversations_rename);
stub!(conversations_delete);
stub!(messages_list);
stub!(messages_send);
stub!(messages_cancel);
stub!(attachments_add);
stub!(capture_screen);
stub!(capture_region);
stub!(telemetry_subscribe);
stub!(actions_propose);
stub!(actions_approve);
stub!(actions_deny);
stub!(actions_list);
stub!(permissions_get);
stub!(permissions_patch);
stub!(workspaces_list);
stub!(workspaces_select);
stub!(workspaces_files);
stub!(workspaces_read_file);
stub!(workspaces_write_file);
stub!(terminal_create);
stub!(terminal_input);
stub!(terminal_resize);
stub!(terminal_close);
stub!(memory_search);
stub!(memory_add);
stub!(memory_forget);
stub!(reminders_list);
stub!(reminders_create);
stub!(reminders_update);
stub!(reminders_delete);
stub!(tasks_list);
stub!(tasks_upsert);
stub!(tasks_delete);
stub!(research_start);
stub!(research_cancel);
stub!(research_report);
stub!(plugins_list);
stub!(plugins_toggle);
stub!(plugins_run);
stub!(updates_status);
stub!(updates_check);
stub!(updates_download);
stub!(updates_install);
stub!(dashboard_start);
stub!(dashboard_revoke);
stub!(lock_set);
stub!(lock_unlock);
stub!(diagnostics_logs);
stub!(diagnostics_export);

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .manage(SidecarState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            app_health,
            start_backend,
            notify_os,
            capture_screen_base64,
            window_hide,
            window_show,
            window_fullscreen,
            window_mini,
            setup_status,
            setup_complete,
            settings_get,
            settings_patch,
            settings_locale,
            credentials_set,
            credentials_test,
            providers_list,
            providers_upsert,
            providers_apply,
            conversations_list,
            conversations_create,
            conversations_rename,
            conversations_delete,
            messages_list,
            messages_send,
            messages_cancel,
            attachments_add,
            capture_screen,
            capture_region,
            telemetry_subscribe,
            actions_propose,
            actions_approve,
            actions_deny,
            actions_list,
            permissions_get,
            permissions_patch,
            workspaces_list,
            workspaces_select,
            workspaces_files,
            workspaces_read_file,
            workspaces_write_file,
            terminal_create,
            terminal_input,
            terminal_resize,
            terminal_close,
            memory_search,
            memory_add,
            memory_forget,
            reminders_list,
            reminders_create,
            reminders_update,
            reminders_delete,
            tasks_list,
            tasks_upsert,
            tasks_delete,
            research_start,
            research_cancel,
            research_report,
            plugins_list,
            plugins_toggle,
            plugins_run,
            updates_status,
            updates_check,
            updates_download,
            updates_install,
            dashboard_start,
            dashboard_revoke,
            lock_set,
            lock_unlock,
            diagnostics_logs,
            diagnostics_export
        ])
        .build(tauri::generate_context!())
        .expect("ошибка запуска оболочки Tauri")
        .run(|_app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                if let Some(state) = _app.try_state::<SidecarState>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            child.stop();
                        }
                    }
                }
            }
        });
}
