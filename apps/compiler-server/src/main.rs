use axum::{
    extract::{DefaultBodyLimit, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use std::{
    env, fs,
    net::SocketAddr,
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tikzforge_graphic_ir::{CompileError, RenderRequest, RenderResponse, Renderer};
use tikzforge_tikz_serializer::{
    document_source, parse_compile_errors, pdf_path, validate_images, validate_source,
};
use tokio::process::Command;
use tokio::time::timeout;

const CHILD_PATH: &str = "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin";
const MAX_LOG_BYTES: usize = 64 * 1024;
/// Source plus base64 image attachments (at most 8 MiB decoded, about 11 MiB encoded).
const MAX_REQUEST_BYTES: usize = 16 * 1024 * 1024;

struct Tectonic {
    binary: PathBuf,
    /// Passed through explicitly because child processes start from a cleared environment.
    cache_dir: Option<PathBuf>,
}

struct AppState {
    tectonic: Option<Tectonic>,
    compile_timeout: Duration,
    convert_timeout: Duration,
}

/// The service could not compile at all, as opposed to the submitted LaTeX being wrong. The web
/// app answers these with its fast renderer instead of showing them as source errors.
struct Unavailable {
    status: StatusCode,
    log: String,
}

impl Unavailable {
    fn new(status: StatusCode, log: impl Into<String>) -> Self {
        Self {
            status,
            log: log.into(),
        }
    }
}

/// Removes the per-request scratch directory on every exit path.
struct ScratchDir(PathBuf);

impl ScratchDir {
    fn create() -> std::io::Result<Self> {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|elapsed| elapsed.as_nanos())
            .unwrap_or_default();
        let directory = env::temp_dir().join(format!("tikzforge-{}-{unique}", std::process::id()));
        fs::create_dir(&directory)?;
        Ok(Self(directory))
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for ScratchDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn tectonic_from_env() -> Option<Tectonic> {
    let binary = PathBuf::from(env::var_os("TECTONIC_BIN")?);
    if !binary.is_file() {
        eprintln!(
            "TECTONIC_BIN={} is not a file; LaTeX compilation is disabled.",
            binary.display()
        );
        return None;
    }
    Some(Tectonic {
        binary,
        cache_dir: env::var_os("TECTONIC_CACHE_DIR").map(PathBuf::from),
    })
}

fn bounded_log(log: String) -> String {
    if log.len() <= MAX_LOG_BYTES {
        return log;
    }
    let mut end = MAX_LOG_BYTES;
    while !log.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}\n[log truncated]", &log[..end])
}

fn response(
    success: bool,
    svg: Option<String>,
    started: Instant,
    log: String,
    errors: Vec<CompileError>,
) -> RenderResponse {
    RenderResponse {
        success,
        svg,
        compile_time_ms: started.elapsed().as_millis(),
        log: bounded_log(log),
        errors,
        renderer: Renderer::Tectonic,
    }
}

fn restricted_command(program: &Path, working_directory: &Path) -> Command {
    let mut command = Command::new(program);
    command
        .current_dir(working_directory)
        .env_clear()
        .env("PATH", CHILD_PATH)
        .env("HOME", working_directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

async fn compile(
    tectonic: &Tectonic,
    state: &AppState,
    source: &str,
    images: &[(String, Vec<u8>)],
    started: Instant,
) -> Result<RenderResponse, Unavailable> {
    let scratch = ScratchDir::create().map_err(|error| {
        Unavailable::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Could not create a scratch directory: {error}"),
        )
    })?;
    let directory = scratch.path();
    let tex_path = directory.join("main.tex");
    let document = document_source(source);
    fs::write(&tex_path, &document.source).map_err(|error| {
        Unavailable::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Could not write the LaTeX document: {error}"),
        )
    })?;
    // Names are validated plain relative paths, so they stay inside the scratch directory.
    for (name, bytes) in images {
        let path = directory.join(name);
        let written = match path.parent() {
            Some(parent) => fs::create_dir_all(parent).and_then(|()| fs::write(&path, bytes)),
            None => fs::write(&path, bytes),
        };
        written.map_err(|error| {
            Unavailable::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Could not write image {name}: {error}"),
            )
        })?;
    }

    let mut command = restricted_command(&tectonic.binary, directory);
    command
        .arg("--untrusted")
        .arg("--only-cached")
        .arg("--chatter=minimal")
        .arg("--outdir")
        .arg(directory)
        .arg(&tex_path);
    if let Some(cache_dir) = &tectonic.cache_dir {
        command.env("TECTONIC_CACHE_DIR", cache_dir);
    }
    let child = command.spawn().map_err(|error| {
        Unavailable::new(
            StatusCode::SERVICE_UNAVAILABLE,
            format!(
                "Could not start Tectonic at {}: {error}",
                tectonic.binary.display()
            ),
        )
    })?;
    let output = match timeout(state.compile_timeout, child.wait_with_output()).await {
        Ok(Ok(output)) => output,
        Ok(Err(error)) => {
            return Err(Unavailable::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Tectonic did not run to completion: {error}"),
            ))
        }
        Err(_) => {
            return Ok(response(
                false,
                None,
                started,
                "Tectonic compilation timed out.".into(),
                vec![CompileError::error(
                    1,
                    format!(
                        "Compilation exceeded {} ms.",
                        state.compile_timeout.as_millis()
                    ),
                )],
            ))
        }
    };
    let log = format!(
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    if !output.status.success() {
        let mut errors = parse_compile_errors(&log, document.line_offset);
        if errors.is_empty() {
            errors.push(CompileError::error(1, "Tectonic compilation failed."));
        }
        return Ok(response(false, None, started, log, errors));
    }

    let svg_path = directory.join("main.svg");
    let mut conversion = restricted_command(Path::new("pdftocairo"), directory);
    conversion
        .arg("-svg")
        .arg(pdf_path(directory))
        .arg(&svg_path);
    let converter = conversion.spawn().map_err(|error| {
        Unavailable::new(
            StatusCode::SERVICE_UNAVAILABLE,
            format!("Could not start pdftocairo: {error}"),
        )
    })?;
    match timeout(state.convert_timeout, converter.wait_with_output()).await {
        Ok(Ok(converted)) if converted.status.success() => {}
        Ok(Ok(converted)) => {
            return Err(Unavailable::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!(
                    "pdftocairo failed: {}",
                    String::from_utf8_lossy(&converted.stderr).trim()
                ),
            ))
        }
        Ok(Err(error)) => {
            return Err(Unavailable::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("pdftocairo did not run to completion: {error}"),
            ))
        }
        Err(_) => {
            return Err(Unavailable::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "PDF to SVG conversion timed out.",
            ))
        }
    }
    let svg = fs::read_to_string(&svg_path).map_err(|error| {
        Unavailable::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Could not read the converted SVG: {error}"),
        )
    })?;
    Ok(response(true, Some(svg), started, log, Vec::new()))
}

async fn health(State(state): State<Arc<AppState>>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "status": "ok",
        "service": "tikzforge-compiler",
        "tectonic": state.tectonic.is_some(),
    }))
}

async fn render(
    State(state): State<Arc<AppState>>,
    Json(request): Json<RenderRequest>,
) -> (StatusCode, Json<RenderResponse>) {
    let started = Instant::now();
    if let Err(errors) = validate_source(&request.source) {
        return (
            StatusCode::BAD_REQUEST,
            Json(response(
                false,
                None,
                started,
                "Source rejected by compiler security policy.".into(),
                errors,
            )),
        );
    }
    let images = match validate_images(&request.images) {
        Ok(images) => images,
        Err(errors) => {
            return (
                StatusCode::BAD_REQUEST,
                Json(response(
                    false,
                    None,
                    started,
                    "Images rejected by compiler security policy.".into(),
                    errors,
                )),
            )
        }
    };
    let Some(tectonic) = &state.tectonic else {
        let log = "LaTeX compilation is unavailable: TECTONIC_BIN is unset or not a file";
        return (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(response(
                false,
                None,
                started,
                log.into(),
                vec![CompileError::error(1, log)],
            )),
        );
    };
    match compile(tectonic, &state, &request.source, &images, started).await {
        Ok(result) => (
            if result.success {
                StatusCode::OK
            } else {
                StatusCode::UNPROCESSABLE_ENTITY
            },
            Json(result),
        ),
        Err(unavailable) => {
            eprintln!("render unavailable: {}", unavailable.log);
            (
                unavailable.status,
                Json(response(
                    false,
                    None,
                    started,
                    unavailable.log.clone(),
                    vec![CompileError::error(1, unavailable.log)],
                )),
            )
        }
    }
}

#[tokio::main]
async fn main() {
    let tectonic = tectonic_from_env();
    match &tectonic {
        Some(tectonic) => println!("Using Tectonic at {}", tectonic.binary.display()),
        None => eprintln!("LaTeX compilation is disabled; /api/render answers 503."),
    }
    let state = Arc::new(AppState {
        tectonic,
        compile_timeout: Duration::from_secs(10),
        convert_timeout: Duration::from_secs(5),
    });
    let app = Router::new()
        .route("/health", get(health))
        .route("/api/render", post(render))
        .layer(DefaultBodyLimit::max(MAX_REQUEST_BYTES))
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
