# llama-panel

A native macOS desktop app for managing and interacting with [llama-server](https://github.com/ggerganov/llama.cpp/tree/master/examples/server) instances. Built with [Tauri](https://tauri.app/).

<!-- ![screenshot](assets/screenshot.png) -->

## Features

- **Connect** to any running llama-server instance
- **Launch** new llama-server processes with custom arguments
- **Load / unload models** on the fly (router mode)
- **Tune parameters** with interactive sliders and presets (Creative, Balanced, Precise, Deterministic)
- **Playground** for completions and chat with live token counts and performance metrics
- **Slot monitor** with real-time polling

## Install

### Homebrew (recommended)

```bash
brew tap AlexsJones/llama-panel
brew install llama-panel
```

This installs the `.app` bundle to `/Applications` and a `llama-panel` command on your `PATH`.

### Download from GitHub Releases

Grab the latest `.tar.gz` from [Releases](https://github.com/AlexsJones/llama-panel/releases), extract it, and drag `llama-panel.app` to `/Applications`:

```bash
tar -xzf llama-panel-v*.tar.gz
mv llama-panel.app /Applications/
```

### From source

Requires [Rust](https://rustup.rs/) and the [Tauri CLI](https://tauri.app/start/):

```bash
cargo install tauri-cli
cargo tauri build
```

The `.app` bundle will be in `target/release/bundle/macos/`.

## Usage

### GUI

Launch from Spotlight, the Applications folder, or:

```bash
llama-panel
```

### Connecting to a server

1. Enter the llama-server URL (default `http://localhost:8080`)
2. Click **Connect**

### Launching a server

On the **Server** tab, provide the path to your `llama-server` binary, choose a port, and add any extra arguments:

```
--ctx-size 4096 --ngl 99 --slots --props
```

### Router mode

When your server supports router mode, use the **Models** tab to load and unload models dynamically. Supports local paths, model aliases, and HuggingFace repos (auto-downloaded).

## Development

```bash
# Install Tauri CLI
cargo install tauri-cli

# Run in dev mode (hot-reload for the UI)
cargo tauri dev
```

The frontend is vanilla HTML/CSS/JS in `ui/` -- no build step required.

## License

[MIT](LICENSE)
