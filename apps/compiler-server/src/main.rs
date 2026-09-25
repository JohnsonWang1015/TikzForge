use axum::{
    extract::State,
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use std::{
    env, fs,
    net::SocketAddr,
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tikzforge_graphic_ir::{RenderRequest, RenderResponse};
use tikzforge_tikz_serializer::{
    document_source, fallback_response, parse_compile_errors, pdf_path, validate_source,
};
use tokio::process::Command;
use tokio::time::timeout;

#[derive(Clone)]
struct AppState {
    max_timeout_ms: u64,
}

async fn tectonic_response(source: &str, max_timeout_ms: u64) -> Option<RenderResponse> {
    let binary = env::var("TECTONIC_BIN").ok()?;
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_nanos();
    let directory = env::temp_dir().join(format!("tikzforge-{}-{unique}", std::process::id()));
    fs::create_dir(&directory).ok()?;
    let tex_path = directory.join("main.tex");
    fs::write(&tex_path, document_source(source)).ok()?;
    let started = Instant::now();
    let compile = Command::new(binary)
        .arg("--untrusted")
        .arg("--only-cached")
        .arg("--chatter=minimal")
        .arg("--outdir")
        .arg(&directory)
        .arg(&tex_path)
        .current_dir(&directory)
        .env_clear()
        .env(
            "PATH",
            "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        )
        .env("HOME", "/tmp")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .ok()?;
    let output = match timeout(
        Duration::from_millis(max_timeout_ms),
        compile.wait_with_output(),
    )
    .await
    {
        Ok(Ok(output)) => output,
        _ => {
            let _ = fs::remove_dir_all(&directory);
            return Some(RenderResponse {
                success: false,
                svg: None,
                compile_time_ms: started.elapsed().as_millis(),
                log: "Tectonic compilation timed out.".into(),
                errors: vec![tikzforge_graphic_ir::CompileError {
                    line: 1,
                    message: "Compiler timeout exceeded.".into(),
                }],
            });
        }
    };
    let log = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        let errors = parse_compile_errors(&log);
        let _ = fs::remove_dir_all(&directory);
        return Some(RenderResponse {
            success: false,
            svg: None,
            compile_time_ms: started.elapsed().as_millis(),
            log,
            errors: if errors.is_empty() {
                vec![tikzforge_graphic_ir::CompileError {
                    line: 1,
                    message: "Tectonic compilation failed.".into(),
                }]
            } else {
                errors
            },
        });
    }
    let pdf = pdf_path(&directory);
    let svg_path = directory.join("main.svg");
    let conversion = Command::new("pdftocairo")
        .arg("-svg")
        .arg(&pdf)
        .arg(&svg_path)
        .current_dir(&directory)
        .env_clear()
        .env(
            "PATH",
            "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        )
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .ok();
    if let Some(process) = conversion {
        let _ = timeout(
            Duration::from_millis(max_timeout_ms),
            process.wait_with_output(),
        )
        .await;
    }
    let svg = fs::read_to_string(&svg_path).ok();
    let _ = fs::remove_dir_all(&directory);
    Some(RenderResponse {
        success: svg.is_some(),
        svg,
        compile_time_ms: started.elapsed().as_millis(),
        log,
        errors: Vec::new(),
    })
}

async fn health() -> Json<serde_json::Value> {
    Json(serde_json::json!({ "status": "ok", "service": "tikzforge-compiler" }))
}

async fn render(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RenderRequest>,
) -> (StatusCode, Json<RenderResponse>) {
    let started = Instant::now();
    if let Err(errors) = validate_source(&request.source) {
        return (
            StatusCode::BAD_REQUEST,
            Json(RenderResponse {
                success: false,
                svg: None,
                compile_time_ms: started.elapsed().as_millis(),
                log: "Source rejected by compiler security policy.".into(),
                errors,
            }),
        );
    }
    if let Some(response) = tectonic_response(&request.source, state.max_timeout_ms).await {
        return (
            if response.success {
                StatusCode::OK
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            },
            Json(response),
        );
    }
    let mut response = fallback_response(&request.source, started.elapsed().as_millis());
    response.log = format!("{} timeout={}ms", response.log, state.max_timeout_ms);
    (StatusCode::OK, Json(response))
}

#[tokio::main]
async fn main() {
    let state = Arc::new(AppState {
        max_timeout_ms: 10_000,
    });
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/render", post(render))
        .with_state(state);
    let address: SocketAddr = "0.0.0.0:8080".parse().expect("valid listen address");
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .expect("bind compiler port");
    println!("TikzForge compiler service listening on {address}");
    axum::serve(listener, app)
        .await
        .expect("compiler service stopped");
}
