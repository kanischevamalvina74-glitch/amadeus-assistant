//! Нативная оболочка Амадеуса.
//!
//! Команды ниже — заглушки с тем же контрактом, что и HTTP-зеркало в
//! `replica/backend/core/app.py`. Реализация появится вместе с нативными
//! возможностями (окна, ввод, скриншот, keychain, уведомления, обновления).
//! Фронтенд пока говорит с ядром по HTTP; переход на invoke() не меняет
//! сигнатуры экранов — меняется только `replica/app/src/lib/api.ts`.

use base64::Engine;
use serde_json::{json, Value};
use tauri::Manager;

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
        .invoke_handler(tauri::generate_handler![
            app_health,
            notify_os,
            capture_screen_base64,
            window_hide,
            window_show,
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
        .run(tauri::generate_context!())
        .expect("ошибка запуска оболочки Tauri");
}
