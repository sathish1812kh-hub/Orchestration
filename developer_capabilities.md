# Developer Capabilities Guide

This guide describes how developers and automated clients can leverage the core filesystem, terminal, and connector orchestration capabilities of **Platform v2.0**.

---

## 📂 Filesystem Capabilities

The platform provides comprehensive access to local workspaces while maintaining security boundaries:
* **Directory Trees:** Use `workspace_tree` to fetch the file structure up to a designated depth.
* **Fuzzy Search:** Use `search_files` to find matching files by name or content regex queries.
* **Codebase Dependency Analysis:** Use `project_analyze` to parse local imports, list workspace packages, detect circular dependencies, and list unused files.
* **Gated File Access:** All read/write/append actions run through the security policy validation layer to block manipulation of critical OS folders (e.g., `C:\Windows`).

---

## 💻 Terminal Capabilities

Terminal tools expose full interactive shell sessions with the host OS:
* **Persistent Sessions:** The `terminal_session_create` tool launches a background shell process (PowerShell, cmd, WSL) which remains active across multiple HTTP/JSON-RPC requests.
* **Diagnostics & Stabilization:** Terminal sessions track stderr/stdout streams and wait for prompt stabilization using the `wait_prompt` tool. This ensures commands are not written before the shell is ready to receive input.
* **Keystroke Simulation:** Standard key presses and virtual key combinations (like `Ctrl+C` for command cancellation) can be simulated using `send_key`.
* **Output Streaming:** Clients can subscribe to real-time stdout/stderr streams by calling `stream_terminal`.

---

## 🔌 Connector Orchestration Capabilities

Connectors wrap vendor AI command-line interfaces and provide execution sandboxes:
* **Antigravity Connector:** Interops directly with the local PowerShell process to execute prompts, capture screen buffers, and handle graceful recovery.
* **Capability Negotiation:** Connectors advertise specific functional capabilities (e.g. `code.generate`). When a client requests task execution, the gateway automatically routes the task to the connector with matching capabilities.
* **Dynamic Recovery:** If a connector process crashes or hangs, the runtime invokes `connector_recovery` to recycle the child process and restore the session context.
