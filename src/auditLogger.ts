import * as fs from 'fs';
import * as path from 'path';
import { AuditLogEntry } from './types';

export class AuditLogger {
  private logPath: string;

  constructor(workspaceRoot: string) {
    this.logPath = path.join(workspaceRoot, 'audit_log.jsonl');
  }

  public log(entry: Partial<AuditLogEntry>): void {
    const fullEntry: AuditLogEntry = {
      timestamp: new Date().toISOString(),
      toolName: entry.toolName || 'unknown',
      userPrompt: entry.userPrompt,
      command: entry.command,
      duration: entry.duration,
      exitCode: entry.exitCode,
      stdoutSummary: entry.stdoutSummary ? this.summarize(entry.stdoutSummary) : undefined,
      stderrSummary: entry.stderrSummary ? this.summarize(entry.stderrSummary) : undefined,
      policyDecision: entry.policyDecision,
      confirmationResult: entry.confirmationResult
    };

    try {
      fs.appendFileSync(this.logPath, JSON.stringify(fullEntry) + '\n', 'utf-8');
    } catch (error) {
      console.error('Failed to write to audit log:', error);
    }
  }

  private summarize(text: string, maxLen = 300): string {
    if (text.length <= maxLen) return text;
    return text.substring(0, maxLen) + `... [Truncated, total ${text.length} chars]`;
  }
}
