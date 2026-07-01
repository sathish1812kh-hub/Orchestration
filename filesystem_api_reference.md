# Filesystem API Reference

This document provides a detailed reference of the most frequently used MCP tools exposed by the **Enterprise Trusted Filesystem** in Platform v2.0.

---

## 🛠️ Tool Catalog Reference

### 1. Workspace Configuration

#### `filesystem_roots`
* **Input Schema:** `type: "object", properties: {}`
* **Returns:** `{ roots: string[] }`
* **Description:** Lists all active trusted roots registered with the runtime.

#### `filesystem_register`
* **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Absolute folder path to trust" }
    },
    "required": ["path"]
  }
  ```
* **Returns:** `{ success: true, roots: string[] }`
* **Description:** Adds a path to the list of authorized directories.

---

### 2. File & Directory Management

#### `filesystem_list`
* **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Directory to inspect" },
      "recursive": { "type": "boolean", "description": "Scan folders recursively" }
    },
    "required": ["path"]
  }
  ```
* **Returns:** List of file objects containing `name`, `path`, `isDirectory`, `size`, `mtime`.

#### `filesystem_write`
* **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Target file write destination" },
      "content": { "type": "string", "description": "File text payload" }
    },
    "required": ["path", "content"]
  }
  ```
* **Returns:** `{ success: true }`
* **Description:** Writes text content. Automatically creates parent folders if missing.

---

### 3. Smart Search & Analytics

#### `filesystem_search`
* **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Folder to search in" },
      "query": { "type": "string", "description": "Query term or glob pattern" },
      "isRegex": { "type": "boolean", "description": "Treat search as regular expression" }
    },
    "required": ["path", "query"]
  }
  ```
* **Returns:** `{ matches: string[] }`
