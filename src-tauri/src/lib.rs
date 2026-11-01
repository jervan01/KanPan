// Rust 侧只提供 HTTP 能力（绕过 WebView 的 CORS 限制）。
// 行情解析、图表、自选等全部逻辑都在 ../src 的前端里。
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .run(tauri::generate_context!())
        .expect("error while running KanPan");
}
