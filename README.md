<p align="center">
  <img src="src-tauri/icons/icon.png" alt="llama-panel" width="128" />
</p>

<h1 align="center">llama-panel</h1>

<p align="center">
  A native macOS desktop app for managing and interacting with <a href="https://github.com/ggerganov/llama.cpp/tree/master/examples/server">llama-server</a> instances. Built with <a href="https://tauri.app/">Tauri</a>.
</p>

<p align="center">
  <img src="demo0.png" alt="llama-panel demo" width="720" />
</p>

## Features

- **Launch & configure** llama-server with a full options panel -- context size, GPU layers, parallel slots, flash attention, and more
- **Download models from HuggingFace** directly from the app with live search-as-you-type
- **Browse loaded & available models** on the server, load/unload on the fly in router mode
- **Tune parameters** with interactive sliders and presets (Creative, Balanced, Precise, Deterministic)
- **Playground** for completions and chat with performance metrics
- **Slot monitor** with real-time polling

## Server Configuration

Configure and launch llama-server instances with dedicated controls for all common options -- no need to remember CLI flags.

<p align="center">
  <img src="demo0.png" alt="Server configuration" width="720" />
</p>

- **Context & Memory** -- context size, GPU layers, flash attention
- **Slots & Parallelism** -- parallel slots, slot monitoring, continuous batching
- **Endpoints & API** -- expose properties, enable metrics, listen host
- Connect to an existing server or launch a new one and auto-connect

## Model Management

Search HuggingFace for GGUF models and start a server with one click. Browse models already loaded on the server, or load/unload them in router mode.

<p align="center">
  <img src="demo1.png" alt="HuggingFace model download" width="720" />
</p>

- **Live search** -- type to search HuggingFace for GGUF models, see download counts and likes
- **One-click download & start** -- select a model, hit "Download & Start", and auto-connect when ready
- **Popular model suggestions** -- quick-pick chips for Gemma, Qwen, Llama, Mistral, Phi, and more
- **Available models list** -- see all loaded and available models on the server with status badges
- **Router mode** -- load and unload models dynamically without restarting the server

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

Launch from Spotlight, the Applications folder, or the command line:

```bash
llama-panel
```

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
