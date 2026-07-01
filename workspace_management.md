# Workspace Management Specification

This specification documents the workspace intelligence, automatic project type detection, and summaries generation capabilities of Platform v2.0.

---

## 🔍 Automatic Project Type Detection

When a folder is loaded or indexed, the `workspace_detect` tool automatically scans for signature project markers:
* **Node.js / npm:** Detects `package.json` and parses dependencies lists.
* **Python:** Detects `requirements.txt`, `pyproject.toml`, or `Pipfile`.
* **Rust:** Detects `Cargo.toml`.
* **Go:** Detects `go.mod`.
* **.NET:** Detects `.sln` or `.csproj` file extensions.
* **Docker:** Detects `Dockerfile` and `docker-compose.yml`.
* **Kubernetes:** Detects deployment yaml configs.

---

## 📊 Workspace Summaries Generation

The `workspace_summary` tool creates structural layout summaries of the project:
1. **Scope:** Lists total file count and size profile.
2. **Frameworks:** Exposes active tooling setups (e.g. Git repositories, Docker configurations).
3. **Libraries:** Parses dependency catalogs to return lists of integrated packages, frameworks, and versions.
