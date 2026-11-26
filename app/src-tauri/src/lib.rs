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
    // Не запускаем второй сайдкар от того же приложения.
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Ok("ядро уже запущено этим приложением".into());
        }
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
                // Пока SQLCipher не подключён, база пользователя хранится открыто в appdata.
                .env("AMADEUS_ALLOW_PLAINTEXT_DB", "1")
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
        // Флаг «ядро завершилось»: если процесс упал на старте, не ждём 2 минуты.
        let exited = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let exited_flag = exited.clone();
        tauri::async_runtime::spawn(async move {
            use tauri_plugin_shell::process::CommandEvent;
            while let Some(event) = rx.recv().await {
                let line = match event {
                    CommandEvent::Stdout(bytes) => format!("[out] {}", String::from_utf8_lossy(&bytes)),
                    CommandEvent::Stderr(bytes) => format!("[err] {}", String::from_utf8_lossy(&bytes)),
                    CommandEvent::Error(message) => format!("[error] {message}"),
                    CommandEvent::Terminated(_) => {
                        exited_flag.store(true, std::sync::atomic::Ordering::SeqCst);
                        break;
                    }
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
        // Ждём, пока ядро реально поднимет порт. Иначе при быстром повторном
        // вызове запускается ещё один сайдкар, который не может занять порт.
        // Ядро на Windows поднимается медленно (PyInstaller + тяжёлые библиотеки),
        // поэтому ждём до 2 минут. Ни в коем случае не убиваем запущенный процесс
        // по таймауту: иначе остаётся «Failed to fetch» и ноль моделей в настройках.
        let mut ready = false;
        for _ in 0..600 {
            if backend_port_open() {
                ready = true;
                break;
            }
            if exited.load(std::sync::atomic::Ordering::SeqCst) {
                return Err("ядро завершилось при запуске, подробности в logs/core.log".into());
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        // Ядро могло занять порт и тут же упасть: перепроверяем флаг уже после готовности.
        if exited.load(std::sync::atomic::Ordering::SeqCst) {
            return Err("ядро завершилось при запуске, подробности в logs/core.log".into());
        }
        *state.0.lock().map_err(|e| e.to_string())? = Some(BackendChild::Sidecar(child));
        return Ok(if ready {
            "ядро запущено из externalBin".into()
        } else {
            "ядро запущено, ожидает готовности; UI продолжит опрашивать :8787".into()
        });
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

/// Размер свёрнутого окошка (логические пиксели): карточка 270×330 и поля под тень.
const MINI_SIZE: (f64, f64) = (300.0, 360.0);
/// Окно сейчас в свёрнутом режиме: только тогда запоминаем его место.
static MINI_ACTIVE: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
/// Окошко убрано «—» на панель задач: при возвращении снова прячем значок.
static MINI_MINIMIZED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

fn mini_pos_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_data_dir().ok().map(|dir| dir.join("mini-window.json"))
}

/// Последнее место окошка. Если карточка не помещается на мониторе целиком,
/// её подвигаем внутрь; если точка вообще не на мониторе — None (будет угол по умолчанию).
fn load_mini_pos(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Option<tauri::PhysicalPosition<i32>> {
    let raw = std::fs::read_to_string(mini_pos_path(app)?).ok()?;
    let value: Value = serde_json::from_str(&raw).ok()?;
    let x = value.get("x")?.as_i64()? as i32;
    let y = value.get("y")?.as_i64()? as i32;
    let monitors = window.available_monitors().ok()?;
    let monitor = monitors.iter().find(|m| {
        let p = m.position();
        let s = m.size();
        x >= p.x && y >= p.y && x < p.x + s.width as i32 && y < p.y + s.height as i32
    })?;
    let p = monitor.position();
    let s = monitor.size();
    let scale = monitor.scale_factor();
    let w = (MINI_SIZE.0 * scale).ceil() as i32;
    let h = (MINI_SIZE.1 * scale).ceil() as i32;
    let max_x = (p.x + s.width as i32 - w).max(p.x);
    let max_y = (p.y + s.height as i32 - h).max(p.y);
    Some(tauri::PhysicalPosition { x: x.clamp(p.x, max_x), y: y.clamp(p.y, max_y) })
}

fn save_mini_pos(app: &tauri::AppHandle, window: &tauri::WebviewWindow) {
    let (Some(path), Ok(pos)) = (mini_pos_path(app), window.outer_position()) else { return };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, json!({ "x": pos.x, "y": pos.y }).to_string());
}

/// Свёрнутый режим: маленькое прозрачное окно без рамки поверх всех окон.
/// Первый раз — правый нижний угол текущего монитора, дальше — где его оставили.
#[tauri::command]
fn window_mini(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("окно main не найдено")?;
    let err = |e: tauri::Error| e.to_string();
    if enabled {
        MINI_ACTIVE.store(true, std::sync::atomic::Ordering::SeqCst);
        MINI_MINIMIZED.store(false, std::sync::atomic::Ordering::SeqCst);
        let (w, h) = MINI_SIZE;
        let _ = window.set_fullscreen(false);
        let _ = window.unmaximize();
        window.set_decorations(false).map_err(err)?;
        let _ = window.set_shadow(false);
        window.set_min_size(None::<tauri::Size>).map_err(err)?;
        window.set_resizable(false).map_err(err)?;
        let _ = window.set_maximizable(false);
        window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: w, height: h })).map_err(err)?;
        window.set_always_on_top(true).map_err(err)?;
        window.set_skip_taskbar(true).map_err(err)?;
        let position = load_mini_pos(&app, &window).or_else(|| {
            let monitor = window.current_monitor().ok().flatten()?;
            let scale = monitor.scale_factor();
            let size = monitor.size();
            let pos = monitor.position();
            // 24 px от края и ещё 48 px снизу под панель задач Windows.
            let x = pos.x + size.width as i32 - ((w + 24.0) * scale) as i32;
            let y = pos.y + size.height as i32 - ((h + 24.0 + 48.0) * scale) as i32;
            Some(tauri::PhysicalPosition { x, y })
        });
        if let Some(position) = position {
            window.set_position(tauri::Position::Physical(position)).map_err(err)?;
        }
    } else {
        MINI_MINIMIZED.store(false, std::sync::atomic::Ordering::SeqCst);
        if MINI_ACTIVE.swap(false, std::sync::atomic::Ordering::SeqCst) {
            save_mini_pos(&app, &window);
        }
        window.set_always_on_top(false).map_err(err)?;
        window.set_skip_taskbar(false).map_err(err)?;
        window.set_decorations(true).map_err(err)?;
        let _ = window.set_shadow(true);
        window.set_resizable(true).map_err(err)?;
        let _ = window.set_maximizable(true);
        window.set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize { width: 900.0, height: 600.0 }))).map_err(err)?;
        window.set_size(tauri::Size::Logical(tauri::LogicalSize { width: 1440.0, height: 900.0 })).map_err(err)?;
        let _ = window.center();
    }
    window.show().map_err(err)?;
    Ok(())
}

/// «—» в окошке: убрать с экрана, но оставить на панели задач, чтобы вернуть одним кликом.
/// Трея пока нет, поэтому прятать окно совсем нельзя — его было бы не найти.
#[tauri::command]
fn window_mini_minimize(app: tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else { return };
    save_mini_pos(&app, &window);
    MINI_MINIMIZED.store(true, std::sync::atomic::Ordering::SeqCst);
    let _ = window.set_skip_taskbar(false);
    let _ = window.minimize();
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
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            // Повторный запуск только фокусирует уже открытое окно.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .manage(SidecarState(Mutex::new(None)))
        .on_window_event(|window, event| {
            // Окошко вернули с панели задач: значок снова не нужен.
            if let tauri::WindowEvent::Focused(true) = event {
                let restored = MINI_ACTIVE.load(std::sync::atomic::Ordering::SeqCst)
                    && MINI_MINIMIZED.swap(false, std::sync::atomic::Ordering::SeqCst);
                if restored {
                    let _ = window.set_skip_taskbar(true);
                    let _ = window.set_always_on_top(true);
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_health,
            start_backend,
            notify_os,
            capture_screen_base64,
            window_hide,
            window_show,
            window_fullscreen,
            window_mini,
            window_mini_minimize,
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
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                // Выходим прямо из окошка: запоминаем, где оно стояло.
                if MINI_ACTIVE.load(std::sync::atomic::Ordering::SeqCst)
                    && !MINI_MINIMIZED.load(std::sync::atomic::Ordering::SeqCst)
                {
                    if let Some(window) = _app.get_webview_window("main") {
                        save_mini_pos(_app, &window);
                    }
                }
            }
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
