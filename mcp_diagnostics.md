# MCP Action Discovery Diagnostics

This document records the diagnostics performed to investigate why ChatGPT displayed "Error refreshing actions" while the MCP transport successfully connected.

---

## 🔍 Root Cause Analysis

1. **Duplicate Tool Registrations:** The audit detected that the tool named `connector_benchmark` was registered twice under two different contexts:
   - Location 1: Line 1840 (Universal Connector Certification)
   - Location 2: Line 2633 (Connector Compatibility Lab)
2. **Strict Client Validation:** The Model Context Protocol (MCP) JSON Schema validation standard prohibits duplicate tool names. Connected clients (like ChatGPT Desktop) abort action discovery when duplicate schemas are returned in the `tools/list` response, throwing an "Error refreshing actions" message.
3. **Expensive Initialization Check:** Initial code ran background filesystem indexing instantly on boot, potentially triggering CPU spikes or I/O delays during client handshakes.

---

## 🛠️ Resolutions Applied

1. **Differentiated Duplicate Names:** Renamed the second `connector_benchmark` tool to `connector_benchmark_run` (updating schema definitions at line 2633 and execution case handler at line 5956).
2. **Defensive Schema Validation & Isolation:** Added a pre-registration validator that runs over all tool definitions. Any invalid or duplicate schema is flagged, logged, and isolated from the returned list of tools, ensuring that errors in one schema do not block overall discovery.
3. **Deferred Indexer Boot:** Deferred the `FilesystemIndexer` background execution so it performs no expensive work during the `initialize` handshake phase.
