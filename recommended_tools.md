# Recommended Tools & Client Compatibility Report

This document evaluates the compatibility of **Platform v2.0** with popular LLM clients and outlines recommendations for future tool development.

---

## 💻 Client Compatibility Matrix

| Client Application | Connection Transport | Compatibility Status | Client-Specific Limitations |
| :--- | :--- | :--- | :--- |
| **ChatGPT (Cloud)** | Streamable HTTP (via ngrok) | ✅ **Compatible** | Requires public TLS endpoint (ngrok). Does not support stdio natively. Has a short response timeout of 10 seconds. |
| **Claude Desktop** | Local Stdio | ✅ **Compatible** | Supports stdio only. Cannot execute Express HTTP handshakes natively. Suppresses stderr output unless logged in developer mode. |
| **Cursor IDE** | Stdio / SSE | ✅ **Compatible** | Supports standard MCP integrations. Can time out on heavy recursive workspace scans. |
| **VS Code (Continue)**| Stdio / SSE | ✅ **Compatible** | Integrates easily, but enforces strict JSON Schema formatting. |
| **Custom Python SDK**| Stdio / SSE / HTTP | ✅ **Compatible** | Full capability discovery supported. |

---

## 🛠️ Recommended Tool Additions

To maximize platform utility for IDE clients (like Cursor or VS Code), we recommend developing and registering the following tools in `src/index.ts`:

### 1. `workspace_grep`
* **Purpose:** Runs high-performance ripgrep or local regex searches on the workspace.
* **Benefit:** Allows Cursor or ChatGPT to quickly locate target function references across the workspace without downloading every source file.

### 2. `structured_diff_apply`
* **Purpose:** Applies a patch/diff to a target file.
* **Benefit:** Saves network token usage by sending only file diffs instead of re-sending full code files during updates.

### 3. `system_performance`
* **Purpose:** Returns host CPU utilization, memory usage, and running process counts.
* **Benefit:** Enables observability agents to monitor the health of the host machine during long-running tasks.
