# P0 Plugin Framework EPERM Startup Fix Report

This report documents the resolution of the **P0 Critical Startup Blocker** caused by the `PluginFramework` attempting to create directories in protected system paths.

---

## 🔍 Root Cause Analysis

Previously, `src/index.ts` instantiated the `PluginFramework` with `path.join(primaryRoot, 'plugins')`.
* When launched under certain IDE or ChatGPT Desktop contexts, `primaryRoot` resolved to `process.cwd()` which pointed to `C:\Windows\System32`.
* The plugin framework attempted to create the directory `C:\Windows\System32\plugins`.
* Because normal user accounts do not have write access to system directories, Node threw an `EPERM: operation not permitted` exception.
* Since this exception was unhandled, the server process crashed before MCP initialization completed, causing ChatGPT/Claude Desktop to report "Server disconnected".

---

## 🛠️ Implemented Fixes

1. **Eliminated `process.cwd()` Dependency:** We replaced the naive path logic with a robust, structured resolution hierarchy:
   1. Check `PLUGIN_DIRECTORY` environment variable.
   2. Check `LOCALAPPDATA\NGROK-MCP\plugins` directory.
   3. Check system home directory user folders (e.g., `~/.local/share/NGROK-MCP/plugins` for non-Windows platforms).
   4. Fall back to `<installation_directory>\plugins`.
2. **Protected Windows Path Verification:** Path names are verified against a blacklist (including `C:\Windows`, `C:\Program Files`, etc.). If a protected path is detected, the setup automatically falls back to a safe folder.
3. **Structured Exception Handling:** Wrapped the `fs.mkdirSync` and file write permission check blocks in a structured try/catch statement.
4. **Bypass on Failure:** If directory creation fails, the Plugin Framework logs a detailed diagnostics summary to `stderr`, disables itself gracefully, and lets the main MCP process boot successfully.

---

## 🧪 Validation & Test Results

I created a suite of automated unit tests in [testPluginDirectory.ts](file:///C:/mcp-chatgptv2/src/testPluginDirectory.ts):
* **Protected Directories Detection:** ✅ **PASS**. Correctly identified and rejected `C:\Windows` and `C:\Windows\System32`.
* **Environment Overrides:** ✅ **PASS**. Correctly prioritized `PLUGIN_DIRECTORY` and `LOCALAPPDATA`.
* **System Path Handlers:** ✅ **PASS**. Bypassed protected folder allocations and fell back to writable directories without crashing.
* **Failure Safety:** ✅ **PASS**. When initialized with an invalid device mount (like `Q:\invalid_drive`), the framework logged the error to `stderr`, disabled itself, and exited the constructor safely.

All 8 automated tests passed successfully with 0 failures!
