# Source Code Intelligence Specification

This document outlines the code and language intelligence capabilities integrated into Platform v2.0.

---

## 🔍 Code Parsing & Analytics

The runtime provides deep structural intelligence for codebase analytics without requiring full external compilation blocks:

1. **Symbol Outlining (`code_outline` / `code_symbols`):**
   * Uses optimized regular expression trees to extract structures (e.g. `class`, `interface`, `def`, `const`) and function parameters.
   * Supports **TypeScript, JavaScript, Python, C#, Rust, Go, Java, and C++**.
2. **Complexity Calculation (`code_complexity`):**
   * Computes Estimated Cyclomatic Complexity by scanning decision control keywords (`if`, `for`, `while`, `catch`, `&&`, `||`).
   * Provides a complexity classification (Low, Moderate, High) to guide automated refactoring.
3. **Workspace Grep (`code_references`):**
   * Locates references of a specific variable or method name across workspace code files recursively, with built-in ignore listings (like `node_modules`).
4. **Task/Issue Extraction (`code_todo` / `code_fixme`):**
   * Identifies pending tasks and bugs by extracting TODO and FIXME annotation blocks from file comments.
