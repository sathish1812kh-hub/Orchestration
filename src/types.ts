export type ShellType = 'powershell' | 'pwsh' | 'cmd' | 'wsl';

export interface Session {
  id: string;
  shellType: ShellType;
  pid: number;
  workspaceRoot: string;
  cwd: string;
  name: string;
  status: 'active' | 'suspended' | 'terminated';
  createdAt: string;
  lastUsedAt: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason: string;
  requiresConfirmation: boolean;
}

export interface AuditLogEntry {
  timestamp: string;
  userPrompt?: string;
  toolName: string;
  command?: string;
  duration?: number;
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  policyDecision?: string;
  confirmationResult?: string;
}

export interface Configuration {
  workspaceRoots: string[];
  blockedCommands: string[];
  confirmationCommands: string[];
  blockedPaths: string[];
  ngrok: {
    authtoken?: string;
    domain?: string;
    port: number;
  };
}
