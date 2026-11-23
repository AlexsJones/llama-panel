#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

/// Disable WebKitGTK's DMA-BUF renderer before the webview is created.
///
/// On some Wayland compositors the renderer freezes the page: the process
/// stays up and the window can still be closed, but input stops landing.
/// That is what the Models tab did on GNOME Wayland (issue #3). WebKitGTK
/// treats `WEBKIT_DISABLE_DMABUF_RENDERER` as a switch — any value disables
/// the renderer and falls back to shared memory, which is slower. It is set
/// for every Linux session because the freeze cannot be detected from here,
/// and it has to be set before WebKit starts.
fn configure_webkit() {
    #[cfg(target_os = "linux")]
    {
        // SAFETY: called from main before the Tauri runtime starts any
        // threads, so nothing else is reading the environment yet.
        unsafe {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }
}

fn main() {
    configure_webkit();
    llama_panel::run()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn linux_disables_webkit_dmabuf_renderer() {
        configure_webkit();
        #[cfg(target_os = "linux")]
        assert_eq!(
            std::env::var("WEBKIT_DISABLE_DMABUF_RENDERER").as_deref(),
            Ok("1")
        );
    }
}
