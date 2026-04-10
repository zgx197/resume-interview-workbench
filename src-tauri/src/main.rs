#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    fs::OpenOptions,
    io::Write,
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};

use tauri::Manager;
use url::Url;

type SharedChild = Arc<Mutex<Option<Child>>>;
const DESKTOP_APP_DIR_NAME: &str = "ResumeInterviewWorkbench";

fn js_string_literal(value: &str) -> String {
    format!("{value:?}")
}

fn build_launcher_eval_script(
    status: &str,
    step: &str,
    status_text: &str,
    title: &str,
    copy: &str,
    detail: &str,
) -> String {
    format!(
        r#"
(() => {{
  window.__desktopLauncherState = {{
    status: {status},
    step: {step},
    statusText: {status_text},
    title: {title},
    copy: {copy},
    detail: {detail}
  }};
  if (typeof window.__desktopLauncherApply === "function") {{
    window.__desktopLauncherApply(window.__desktopLauncherState);
  }}
}})();
"#,
        status = js_string_literal(status),
        step = js_string_literal(step),
        status_text = js_string_literal(status_text),
        title = js_string_literal(title),
        copy = js_string_literal(copy),
        detail = js_string_literal(detail),
    )
}

fn update_launcher_state(
    app: &tauri::AppHandle,
    status: &str,
    step: &str,
    status_text: &str,
    title: &str,
    copy: &str,
    detail: &str,
) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "failed to locate main desktop window".to_string())?;

    window
        .eval(&build_launcher_eval_script(
            status,
            step,
            status_text,
            title,
            copy,
            detail,
        ))
        .map_err(|error| error.to_string())
}

fn resolve_resource_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "failed to resolve desktop executable directory".to_string())?;
    let portable_resource_dir = exe_dir.join("resources");
    if portable_resource_dir.exists() {
        return Ok(portable_resource_dir);
    }

    if let Ok(resource_dir) = app.path().resource_dir() {
        return Ok(resource_dir);
    }

    Ok(exe_dir.join("resources"))
}

fn resolve_local_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        return Ok(PathBuf::from(local_app_data).join(DESKTOP_APP_DIR_NAME));
    }

    if let Ok(data_dir) = app.path().app_local_data_dir() {
        return Ok(data_dir);
    }

    let current_exe = std::env::current_exe().map_err(|error| error.to_string())?;
    let exe_dir = current_exe
        .parent()
        .ok_or_else(|| "failed to resolve desktop executable directory".to_string())?;
    Ok(exe_dir.join("data"))
}

fn append_launcher_log(app: &tauri::AppHandle, message: &str) {
    let timestamp = format!("{:?}", std::time::SystemTime::now());

    let Ok(data_dir) = resolve_local_data_dir(app) else {
        return;
    };

    let logs_dir = data_dir.join("logs");
    if std::fs::create_dir_all(&logs_dir).is_err() {
        return;
    }

    let log_path = logs_dir.join("desktop-launcher.log");
    let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_path)
    else {
        return;
    };

    let _ = writeln!(file, "[{timestamp}] {message}");
}

fn spawn_packaged_backend(app: &tauri::AppHandle) -> Result<Child, String> {
    let resource_dir = resolve_resource_dir(app)?;
    let data_dir = resolve_local_data_dir(app)?;
    let app_root = resource_dir.join("app-runtime");
    let node_exe = resource_dir.join("node").join("windows-x64").join("node.exe");
    let postgres_bin_dir = resource_dir.join("postgres").join("windows-x64").join("bin");
    let env_file = data_dir.join("config").join(".env");
    let logs_dir = data_dir.join("logs");
    let stdout_log_path = logs_dir.join("desktop-backend.log");
    let stderr_log_path = logs_dir.join("desktop-backend.error.log");
    let server_entry = app_root
        .join("app")
        .join("server")
        .join("scripts")
        .join("desktop-dev-server.js");

    append_launcher_log(
        app,
        &format!(
            "spawn backend resource_dir={} app_root={} node_exe={} node_exists={} server_entry={} server_exists={} postgres_bin_dir={}",
            resource_dir.display(),
            app_root.display(),
            node_exe.display(),
            node_exe.exists(),
            server_entry.display(),
            server_entry.exists(),
            postgres_bin_dir.display()
        ),
    );

    std::fs::create_dir_all(data_dir.join("config")).map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&logs_dir).map_err(|error| error.to_string())?;

    let stdout_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stdout_log_path)
        .map_err(|error| error.to_string())?;
    let stderr_log = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&stderr_log_path)
        .map_err(|error| error.to_string())?;

    let mut command = Command::new(node_exe);
    command
        .arg(server_entry)
        .arg("--no-watch")
        .current_dir(&app_root)
        .stdin(Stdio::piped())
        .stdout(Stdio::from(stdout_log))
        .stderr(Stdio::from(stderr_log))
        .env("APP_ROOT", &app_root)
        .env("DESKTOP_APP_MODE", "packaged")
        .env("ENV_FILE", &env_file)
        .env("DESKTOP_ENV_FILE", &env_file)
        .env("DESKTOP_DATA_DIR", &data_dir)
        .env("DESKTOP_DATABASE_MODE", "managed")
        .env("DESKTOP_ALLOW_DOCKER_FALLBACK", "false")
        .env("DESKTOP_POSTGRES_BIN_DIR", &postgres_bin_dir)
        .env("PORT", "3000");

    command.spawn().map_err(|error| {
        format!(
            "failed to start packaged desktop backend with app root {}: {}",
            app_root.display(),
            error
        )
    })
}

fn wait_for_backend_ready(shared_child: &SharedChild, timeout: Duration) -> Result<(), String> {
    let deadline = Instant::now() + timeout;
    let address: SocketAddr = "127.0.0.1:3000"
        .parse::<SocketAddr>()
        .map_err(|error| error.to_string())?;

    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&address, Duration::from_millis(800)).is_ok() {
            return Ok(());
        }

        {
            let mut guard = shared_child
                .lock()
                .map_err(|_| "desktop backend mutex poisoned".to_string())?;
            if let Some(child) = guard.as_mut() {
                if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
                    return Err(format!("desktop backend exited before ready: {status}"));
                }
            }
        }

        thread::sleep(Duration::from_millis(500));
    }

    Err(format!(
        "desktop backend did not become reachable within {} seconds",
        timeout.as_secs()
    ))
}

fn navigate_main_window(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "failed to locate main desktop window".to_string())?;
    let parsed = Url::parse(url).map_err(|error| error.to_string())?;
    window.navigate(parsed).map_err(|error| error.to_string())
}

fn shutdown_backend(shared_child: &SharedChild) {
    let maybe_child = {
        let mut guard = shared_child.lock().expect("desktop backend mutex poisoned");
        guard.take()
    };

    if let Some(mut child) = maybe_child {
        drop(child.stdin.take());

        let deadline = Instant::now() + Duration::from_secs(8);
        loop {
            match child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) if Instant::now() < deadline => {
                    thread::sleep(Duration::from_millis(250));
                }
                Ok(None) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
                Err(_) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    return;
                }
            }
        }
    }
}

fn main() {
    let shared_child: SharedChild = Arc::new(Mutex::new(None));
    let setup_child = shared_child.clone();
    let run_child = shared_child.clone();

    tauri::Builder::default()
        .setup(move |app| {
            if cfg!(debug_assertions) {
                return Ok(());
            }

            let app_handle = app.handle().clone();
            let child_slot = setup_child.clone();

            thread::spawn(move || {
                append_launcher_log(&app_handle, "desktop packaged startup thread entered");
                let _ = update_launcher_state(
                    &app_handle,
                    "starting",
                    "prepare",
                    "准备中...",
                    "正在准备 desktop runtime",
                    "正在检查便携资源、运行目录和本地服务依赖。",
                    "",
                );

                match spawn_packaged_backend(&app_handle) {
                    Ok(child) => {
                        append_launcher_log(&app_handle, "packaged backend spawned");
                        {
                            let mut guard =
                                child_slot.lock().expect("desktop backend mutex poisoned");
                            *guard = Some(child);
                        }

                        let _ = update_launcher_state(
                            &app_handle,
                            "starting",
                            "backend",
                            "启动本地服务...",
                            "正在拉起本地工作台服务",
                            "已定位便携版资源，正在启动 Node 服务和本地托管 PostgreSQL。",
                            "",
                        );

                        let _ = update_launcher_state(
                            &app_handle,
                            "starting",
                            "wait",
                            "等待服务就绪...",
                            "正在等待工作台就绪",
                            "本地服务已经启动，正在等待 http://127.0.0.1:3000 可访问。",
                            "",
                        );

                        if let Err(error) =
                            wait_for_backend_ready(&child_slot, Duration::from_secs(90))
                        {
                            append_launcher_log(
                                &app_handle,
                                &format!("backend failed before ready: {error}"),
                            );
                            eprintln!("[desktop] {}", error);
                            let _ = update_launcher_state(
                                &app_handle,
                                "error",
                                "wait",
                                "启动失败",
                                "桌面工作台启动失败",
                                "未能在预期时间内完成本地服务启动。请检查 bundled Node、PostgreSQL runtime 和日志目录。",
                                &error,
                            );
                            shutdown_backend(&child_slot);
                            return;
                        }

                        let _ = update_launcher_state(
                            &app_handle,
                            "ready",
                            "ready",
                            "准备完成",
                            "桌面工作台已就绪",
                            "本地服务已经就绪，正在进入工作台。",
                            "",
                        );

                        if let Err(error) =
                            navigate_main_window(&app_handle, "http://127.0.0.1:3000")
                        {
                            append_launcher_log(
                                &app_handle,
                                &format!("navigation failed: {error}"),
                            );
                            eprintln!("[desktop] failed to navigate main window: {}", error);
                            let _ = update_launcher_state(
                                &app_handle,
                                "error",
                                "ready",
                                "进入失败",
                                "工作台页面打开失败",
                                "本地服务已经启动，但桌面窗口未能跳转到工作台页面。",
                                &error,
                            );
                        }
                    }
                    Err(error) => {
                        append_launcher_log(
                            &app_handle,
                            &format!("failed to spawn packaged backend: {error}"),
                        );
                        eprintln!("[desktop] {}", error);
                        let _ = update_launcher_state(
                            &app_handle,
                            "error",
                            "prepare",
                            "启动失败",
                            "桌面工作台启动失败",
                            "未能完成便携资源检查或后端进程启动。",
                            &error,
                        );
                    }
                }
            });

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build tauri application")
        .run(move |_app_handle, event| {
            if matches!(
                event,
                tauri::RunEvent::Exit | tauri::RunEvent::ExitRequested { .. }
            ) {
                shutdown_backend(&run_child);
            }
        });
}
