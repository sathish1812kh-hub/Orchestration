# Developer Runtime Guide

This document describes how to configure and run the **Platform v2.0 Developer Runtime** environment.

---

## ⚙️ Configuration Setup

To enable Developer Mode and expose drive-level filesystem mappings to connected IDE/chat clients:

1. **Environment Variables:**
   Create or modify your local `.env` file to set:
   ```ini
   DEVELOPER_MODE=true
   TRUSTED_ROOTS=["C:\\"]
   ```

2. **Server Launch:**
   * Run the local server normally: `node dist/index.js`
   * Or launch in local stdin/stdout Stdio mode for Claude Desktop/Cursor: `node dist/index.js --stdio`

---

## 🔌 IDE Integrations

### 1. Claude Desktop
Add the following connector configuration to `%APPDATA%\Claude\claude_desktop_config.json`:
```json
{
  "mcpServers": {
    "orchestration": {
      "command": "node",
      "args": ["C:/mcp-chatgptv2/dist/index.js", "--stdio"]
    }
  }
}
```

### 2. Cursor IDE
* Open **Settings > Features > MCP**.
* Click **+ Add New MCP Server**.
* Configure Name: `Orchestration`, Type: `stdio`, Command: `node C:/mcp-chatgptv2/dist/index.js --stdio`.
