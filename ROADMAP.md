# Roadmap

llama-panel today starts a `llama-server` process per model, finds GGUFs in the HuggingFace hub cache (and, since v0.12.0, in `LLAMA_ARG_MODELS_DIR` / `LLAMA_CACHE`), and talks to whichever server you connected. Issue [#3](https://github.com/AlexsJones/llama-panel/issues/3) asks for something broader: router mode, `models.ini`, and llama-swap, and a Wayland freeze was reported on the same thread. Those are different pieces of work. This is the order to build them in.

Shipped already, and not part of the milestones below: honouring `HF_HUB_CACHE` / `HF_HOME` / `LLAMA_ARG_MODELS_DIR` / `LLAMA_CACHE`, and treating `mmproj` files as projectors rather than models.

## v0.13 — Router mode

Be a client of a `llama-server` that is already routing, instead of guessing that it is.

There is no unambiguous "this is router mode" signal. A `/models` response with one entry can be a plain server or a router with one preset, so v0.13 does not auto-detect. The user sets a router endpoint. While it is set, llama-panel does not start its own `llama-server`.

- Save the endpoint (http or https, trimmed, blank clears it) and read it back on startup.
- List presets with the existing `list_available_models` command (`GET /models`) and load or unload them with the existing `load_model` / `unload_model` commands (`POST /models/load`, `POST /models/unload`).
- Show each preset's `status.value`: loaded, sleeping as its own idle state, a spinner while loading, nothing when unloaded, the exit code when `failed` is set, the raw string for anything else, and no badge when `status` is missing. Several presets can be loaded at once (`--models-max`).
- Keep an in-flight Load or Unload disabled across the status refresh.
- Send the preset id as `model` from the Playground (`/completion` and `/v1/chat/completions`) and from OpenCode. A router rejects a chat request that omits it.

Out of this release: editing `models.ini`, and llama-swap.

## v0.14 — `models.ini` and llama-swap

Router mode consumes a catalog. This release is how that catalog, and the other tool that solves the same problem, get managed.

**`models.ini`.** llama-server's preset file is the source of per-model arguments (path, mmproj, context, extra flags). The router already echoes each preset's ini snippet. v0.14 should open that file, edit a preset, write it back, and refresh the list. It should not start the router process; the endpoint from v0.13 stays how llama-panel attaches.

**llama-swap.** It also serves many models on one port, with its own config and API, and it does not speak llama-server router mode. Add it as a second external backend: a base URL, the model list, and whatever id its requests require. Do not send llama-swap traffic through `/models/load`.

## 1.0

The desktop app is the one place you run either kind of server, on macOS and on Linux.

- Local processes and a router endpoint coexist without both trying to own the same GGUFs. Leaving the endpoint blank is today's behaviour.
- `models.ini` editing and llama-swap from v0.14 are in, or the issues below are still open and the app does not pretend otherwise.
- Install paths match what the release workflow builds: Homebrew and the macOS tarball, plus the Linux amd64 `.deb` and AppImage.
- The Models tab stays usable on Wayland without the user exporting `WEBKIT_DISABLE_DMABUF_RENDERER`.
- Model discovery (`is_mmproj_name`, loose model directories) stays covered by tests, and `lib.rs` is not the only place that code lives.

## Splitting issue #3

[#3](https://github.com/AlexsJones/llama-panel/issues/3) is titled "Add support for llama-cpp router mode and llama-swap". The body also asks llama-panel to detect router mode, to use the separate models directory, and to start and stop models individually. v0.12.0 already did the directory half. A later comment on the same issue reports the Models tab freezing on Wayland, which is a bug rather than part of the feature. The thread then settled router mode as an explicit endpoint, and left `models.ini` and llama-swap for later.

These issues are proposed here and are not filed. #3 should stay open and be narrowed to the router client (v0.13). The other three should be new issues.

### Keep on #3 — Router mode client

Retitle to something like "Drive a llama-server in router mode from an explicit endpoint".

Scope that remains:

- A saved router endpoint. No auto-detect. A one-model response is a plain server.
- List, load, and unload presets through `list_available_models`, `load_model`, and `unload_model`.
- Per-preset state from `status.value`, including sleeping, loading, and `failed` plus `exit_code`.
- While the endpoint is set, do not start a local `llama-server`.
- Playground and OpenCode send that preset id as `model`.

Already done, and worth saying so on the issue: `HF_HUB_CACHE`, `HF_HOME`, `LLAMA_ARG_MODELS_DIR`, and `LLAMA_CACHE` (v0.12.0).

Not this issue anymore: `models.ini` editing, llama-swap, the Wayland freeze.

### New issue — Manage llama-server `models.ini` presets

**Title:** Manage llama-server `models.ini` presets

**Labels:** enhancement

**Body:**

`llama-server` in router mode can take its catalog from a [`models.ini`](https://github.com/ggml-org/llama.cpp/tree/master/tools/server#model-presets) file. Each section is a preset: the GGUF path, an optional mmproj, context size, and other arguments. llama-panel's router client can list those presets and load or unload them once an endpoint is set, and `GET /models` even echoes the ini snippet for each entry. It cannot create, edit, or remove a preset.

This issue is that editor.

- Point at the `models.ini` the running router is using (or at a path the user picks).
- Show the presets as editable fields, not a raw text dump only.
- Write the file back and refresh the preset list from the router.
- Cover the fields people actually set per model: model path, mmproj, context, and extra arguments.

Out of scope: starting or stopping the router process, auto-detecting router mode, and llama-swap. Those are separate. The router endpoint work stays on #3.

Split out of #3.

### New issue — Add llama-swap as a backend

**Title:** Add llama-swap as a backend

**Labels:** enhancement

**Body:**

[llama-swap](https://github.com/mostlygeek/llama-swap) also fronts several models with one port and one panel, but it is a different program. It has its own config and HTTP API, and it does not speak llama-server router mode (`/models/load`, `/models/unload`, `status.value`). Issue #3 asked for both. The router client has to come first so we can see which parts of "list models, send `model` on the request, don't spawn a second manager" are actually reusable.

This issue is the llama-swap backend, after that client exists.

- A saved llama-swap base URL, separate from the llama-server router endpoint.
- List the models llama-swap knows about.
- Load and unload, or the equivalent llama-swap operations, through its API rather than `/models/load`.
- Playground and OpenCode send the id llama-swap expects.

Out of scope: `models.ini`, which is llama-server's format, and the Wayland webview freeze. Don't route llama-swap through the llama-server commands just because both sit on one port.

Split out of #3.

### New issue — Models tab freezes on Wayland

**Title:** Models tab freezes on Wayland

**Labels:** bug

**Body:**

Reported by @LFd3v on #3 (2026-07-02), on llama-panel v0.12.0, Garuda/Arch, GNOME Wayland:

> the UI freezes after a while in the Models tab after scrolling the list up and down. Nothing responds to mouse click anymore, only the app can be closed, and no visible errors in the console.

About 38 models were detected. After a reboot the freeze did not come back, so it was not confirmed on that machine.

This matches the WebKitGTK DMA-BUF renderer bug: the webview stops presenting frames, the process is healthy, and the window can still be closed. The variable WebKitGTK checks before creating the webview is `WEBKIT_DISABLE_DMABUF_RENDERER`. Setting it uses the shared-memory renderer, which is slower, and WebKit treats any value as off.

Track this separately from router mode. It reproduces (or not) with no llama-server involved.

- Set `WEBKIT_DISABLE_DMABUF_RENDERER=1` on Linux before the webview is created, so people don't have to export it.
- Note the tradeoff: every Linux session loses the DMA-BUF path, including ones that were not freezing. The failure depends on the compositor and the driver, and the app cannot detect it.
- Confirm on a Wayland session that actually hit the freeze. An X11 VM without DRM cannot.

Split out of the comment thread on #3. It is not part of the router, `models.ini`, or llama-swap work.
