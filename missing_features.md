# Platform v2.0 Gap Analysis & Missing Features

This document identifies feature gaps in **Platform v2.0** that developers commonly expect from an enterprise-grade AI gateway, and proposes design solutions for them.

---

## 🔍 Identified Capability Gaps

While the platform has a rich set of 100+ tools, several lower-level developer conveniences are missing from the native implementation:

| Domain | Missing Capability | Impact | Proposed Solution |
| :--- | :--- | :--- | :--- |
| **Filesystem** | **Recursive Directory Stats** | Standard `list_directory` only lists immediate children. Clients must make multiple recursive calls to calculate project size. | Add a `directory_stats` tool that recursively computes directory size, file counts, and folder counts. |
| **Filesystem** | **Structured Diffs** | File modifications require full overwrites (`write_file`) or regex replacements (`replace_text`). This is slow and error-prone. | Implement a `apply_patch` tool accepting unified diff strings (diff blocks) to perform safe, partial file modifications. |
| **Filesystem** | **Workspace Indexing** | Searching inside large codebases relies on regex grep-scans, which can time out on large workspaces. | Implement a background workspace indexer (`workspace_index_build`) creating a lightweight inverted index for fast keyword lookups. |
| **Filesystem** | **Archive Creation** | No tools exist to zip/unzip files for packaging or distribution. | Create `archive_zip` and `archive_unzip` tools using node's compression streams. |
| **Process** | **System Resource Inspection**| Cannot query general system disk space, RAM, or network metrics directly without running terminal commands. | Add a `system_resources` tool returning CPU load, RAM allocation, and free disk space. |
| **Process** | **Service Management** | Cannot register or control Windows Services. | Add a `service_control` tool that interacts with the Windows Service Controller. |

---

## 🛠️ Proposed Tool Design Specifications

### 1. `directory_stats`
* **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Target folder path" },
      "recursive": { "type": "boolean", "description": "True to run recursively" }
    },
    "required": ["path"]
  }
  ```
* **Output:** Returns total folder count, total file count, total size in bytes, list of 10 largest files, and duplicate file checksum detections.

### 2. `apply_patch`
* **Input Schema:**
  ```json
  {
    "type": "object",
    "properties": {
      "path": { "type": "string", "description": "Target file path" },
      "patch": { "type": "string", "description": "Unified diff patch content" }
    },
    "required": ["path", "patch"]
  }
  ```
* **Output:** Returns `status: "success"` and the modified file lines.
