# Invalid Tool Schema Isolation Report

This report documents all tool schemas that failed pre-registration validation or duplication checks and were isolated to prevent action discovery blocks.

---

## ⚠️ Isolated Tools List

### ❌ `configuration_set`
* **Error Reason:** Schema validation failed: Property 'value' is missing 'type'
* **Stack Trace:**
```
Error: Schema validation failed: Property 'value' is missing 'type'
    at validateAndFilterTools (C:\mcp-chatgptv2\dist\index.js:362:23)
    at listToolsHandler (C:\mcp-chatgptv2\dist\index.js:3361:59)
    at C:\mcp-chatgptv2\node_modules\@modelcontextprotocol\sdk\dist\cjs\shared\protocol.js:895:36
    at C:\mcp-chatgptv2\node_modules\@modelcontextprotocol\sdk\dist\cjs\shared\protocol.js:371:25
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
```

### ❌ `configuration_validate`
* **Error Reason:** Schema validation failed: Property 'value' is missing 'type'
* **Stack Trace:**
```
Error: Schema validation failed: Property 'value' is missing 'type'
    at validateAndFilterTools (C:\mcp-chatgptv2\dist\index.js:362:23)
    at listToolsHandler (C:\mcp-chatgptv2\dist\index.js:3361:59)
    at C:\mcp-chatgptv2\node_modules\@modelcontextprotocol\sdk\dist\cjs\shared\protocol.js:895:36
    at C:\mcp-chatgptv2\node_modules\@modelcontextprotocol\sdk\dist\cjs\shared\protocol.js:371:25
    at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
```

