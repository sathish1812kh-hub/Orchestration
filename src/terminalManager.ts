import { spawn, execSync, ChildProcessWithoutNullStreams } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import { ShellType } from './types';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';

export interface TerminalMetadata {
  uuid: string;
  pid: number;
  parentPid: number;
  shellType: ShellType;
  title: string;
  cwd: string;
  startTime: string;
  status: string;
  busyState: string;
  imported: boolean;
  attachedClients: number;
  lastActivity: string;
  windowHandle: string;
}

class PromiseQueue {
  private queue: Promise<any> = Promise.resolve();

  public enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }
}

export class InteractiveTerminal {
  public readonly uuid: string;
  public readonly pid: number;
  public readonly parentPid: number;
  public readonly shellType: ShellType;
  public readonly imported: boolean;
  public readonly workspaceRoot: string;
  public readonly startTime: string;
  
  public cwd: string;
  public title: string;
  public windowHandle = '0x0';
  public lastActivity: string;
  public busyState = 'Idle';
  public attachedClients = 0;

  private bridgeProcess!: ChildProcessWithoutNullStreams;
  private stdoutBuffer = '';
  private pendingReads: Array<{ resolve: (val: any) => void; reject: (err: any) => void }> = [];
  private lockQueue = new PromiseQueue();
  private isBridgeRunning = false;

  constructor(
    uuid: string,
    pid: number,
    parentPid: number,
    shellType: ShellType,
    imported: boolean,
    workspaceRoot: string,
    title = '',
    startTime = ''
  ) {
    this.uuid = uuid;
    this.pid = pid;
    this.parentPid = parentPid;
    this.shellType = shellType;
    this.imported = imported;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.cwd = this.workspaceRoot;
    this.title = title;
    this.startTime = startTime || new Date().toISOString();
    this.lastActivity = new Date().toISOString();

    this.startBridge();
  }

  private startBridge() {
    const bridgePath = path.join(process.cwd(), 'dist', 'ConsoleBridge.exe');
    if (!fs.existsSync(bridgePath)) {
      throw new Error(`ConsoleBridge.exe not found at ${bridgePath}. Compile it first.`);
    }

    this.bridgeProcess = spawn(bridgePath, [this.pid.toString()], { shell: false });
    this.isBridgeRunning = true;

    this.bridgeProcess.stdout.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      this.processStdout();
    });

    this.bridgeProcess.stderr.on('data', (data) => {
      console.error(`ConsoleBridge STDERR (PID ${this.pid}):`, data.toString());
    });

    this.bridgeProcess.on('close', () => {
      this.isBridgeRunning = false;
      this.busyState = 'Closed';
      // Reject any pending reads
      while (this.pendingReads.length > 0) {
        const req = this.pendingReads.shift()!;
        req.reject(new Error('Console bridge process terminated.'));
      }
    });

    this.bridgeProcess.on('error', (err) => {
      console.error(`ConsoleBridge error (PID ${this.pid}):`, err);
      this.isBridgeRunning = false;
      this.busyState = 'Suspended';
    });
  }

  private processStdout() {
    const lines = this.stdoutBuffer.split('\n');
    this.stdoutBuffer = lines.pop() || ''; // Keep incomplete line

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const parsed = JSON.parse(trimmed);
        
        if (parsed.status === 'attached') {
          continue;
        }

        if (this.pendingReads.length > 0) {
          const req = this.pendingReads.shift()!;
          if (parsed.status === 'success') {
            req.resolve(parsed.data || parsed);
          } else {
            req.reject(new Error(parsed.message || 'Execution failed'));
          }
        }
      } catch (e) {
        // Output might not be JSON, skip or log
      }
    }
  }

  private sendCommand(cmd: any): Promise<any> {
    if (!this.isBridgeRunning) {
      return Promise.reject(new Error('Terminal bridge is not running.'));
    }

    this.lastActivity = new Date().toISOString();
    return this.lockQueue.enqueue(() => {
      return new Promise<any>((resolve, reject) => {
        this.pendingReads.push({ resolve, reject });
        this.bridgeProcess.stdin.write(JSON.stringify(cmd) + '\n');
      });
    });
  }

  public async capture(scrollback = false): Promise<{ visible: string; scrollback: string; cursorX: number; cursorY: number; cols: number; rows: number }> {
    this.busyState = 'Streaming';
    try {
      const res = await this.sendCommand({ action: 'read', scrollback });
      if (res.windowHandle) {
        this.windowHandle = res.windowHandle;
      }
      this.busyState = 'Idle';
      return res;
    } catch (e) {
      this.busyState = 'Suspended';
      throw e;
    }
  }

  public async write(text: string): Promise<any> {
    this.busyState = 'Running';
    try {
      const res = await this.sendCommand({ action: 'write', text });
      this.busyState = 'Prompt Ready';
      return res;
    } catch (e) {
      this.busyState = 'Suspended';
      throw e;
    }
  }

  public async sendKey(keyCode: number, controlState = 0): Promise<any> {
    this.busyState = 'Running';
    try {
      const res = await this.sendCommand({ action: 'key', keyCode, controlState });
      this.busyState = 'Idle';
      return res;
    } catch (e) {
      this.busyState = 'Suspended';
      throw e;
    }
  }

  public async focus(): Promise<any> {
    this.busyState = 'Running';
    try {
      const res = await this.sendCommand({ action: 'focus' });
      this.busyState = 'Idle';
      return res;
    } catch (e) {
      this.busyState = 'Suspended';
      throw e;
    }
  }

  public close(): void {
    this.busyState = 'Closed';
    if (this.isBridgeRunning) {
      try {
        this.bridgeProcess.stdin.write(JSON.stringify({ action: 'close' }) + '\n');
        this.bridgeProcess.kill();
      } catch (e) {
        // Ignore
      }
    }
  }

  public getMetadata(): TerminalMetadata {
    return {
      uuid: this.uuid,
      pid: this.pid,
      parentPid: this.parentPid,
      shellType: this.shellType,
      title: this.title,
      cwd: this.cwd,
      startTime: this.startTime,
      status: this.isBridgeRunning ? 'active' : 'suspended',
      busyState: this.busyState,
      imported: this.imported,
      attachedClients: this.attachedClients,
      lastActivity: this.lastActivity,
      windowHandle: this.windowHandle
    };
  }
}

export class TerminalManager {
  private terminals = new Map<string, InteractiveTerminal>();
  private registryFile: string;
  private policyEngine: PolicyEngine;
  private auditLogger: AuditLogger;

  constructor(workspaceRoot: string, policyEngine: PolicyEngine, auditLogger: AuditLogger) {
    this.registryFile = path.join(workspaceRoot, 'terminal_registry.json');
    this.policyEngine = policyEngine;
    this.auditLogger = auditLogger;
    
    this.loadRegistry();
  }

  private loadRegistry() {
    if (fs.existsSync(this.registryFile)) {
      try {
        const data = fs.readFileSync(this.registryFile, 'utf-8');
        const list = JSON.parse(data) as any[];
        for (const item of list) {
          // Check if process is still running
          if (this.isProcessRunning(item.pid)) {
            const term = new InteractiveTerminal(
              item.uuid,
              item.pid,
              item.parentPid || 0,
              item.shellType,
              item.imported,
              item.workspaceRoot || process.cwd(),
              item.title,
              item.startTime
            );
            this.terminals.set(term.uuid, term);
          }
        }
      } catch (error) {
        console.error('Failed to load terminal registry:', error);
      }
    }
  }

  private saveRegistry() {
    try {
      const list = Array.from(this.terminals.values()).map(t => {
        const meta = t.getMetadata();
        return {
          uuid: meta.uuid,
          pid: meta.pid,
          parentPid: meta.parentPid,
          shellType: meta.shellType,
          imported: meta.imported,
          workspaceRoot: t.workspaceRoot,
          title: meta.title,
          startTime: meta.startTime
        };
      });
      fs.writeFileSync(this.registryFile, JSON.stringify(list, null, 2), 'utf-8');
    } catch (error) {
      console.error('Failed to save terminal registry:', error);
    }
  }

  private isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  public async discoverTerminals(): Promise<TerminalMetadata[]> {
    return new Promise((resolve) => {
      // Discover terminal processes using powershell
      const script = `
Get-Process | Where-Object { $_.ProcessName -in 'powershell', 'pwsh', 'cmd', 'wsl', 'wslhost', 'bash', 'WindowsTerminal' } | ForEach-Object {
  $pId = $_.Id;
  $parentPid = 0;
  try { $parentPid = (Get-CimInstance Win32_Process -Filter "ProcessId = $pId").ParentProcessId } catch {};
  [PSCustomObject]@{
    pid = $pId;
    parentPid = $parentPid;
    name = $_.ProcessName;
    title = $_.MainWindowTitle;
    startTime = $_.StartTime.ToString("yyyy-MM-ddTHH:mm:ss")
  }
} | ConvertTo-Json
`.trim();

      const proc = spawn('powershell.exe', ['-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { shell: false });
      let stdout = '';
      
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.on('close', () => {
        if (!stdout.trim()) {
          resolve([]);
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          const rawList = Array.isArray(parsed) ? parsed : [parsed];
          const discovered: TerminalMetadata[] = rawList
            .filter((p: any) => p && typeof p.pid === 'number')
            .map((p: any) => {
              // Determine shell type
              let shellType: ShellType = 'powershell';
              if (p.name.toLowerCase().includes('pwsh')) shellType = 'pwsh';
              else if (p.name.toLowerCase().includes('cmd')) shellType = 'cmd';
              else if (p.name.toLowerCase().includes('wsl') || p.name.toLowerCase().includes('bash')) shellType = 'wsl';

              // Check if we already have this terminal in our registry
              const existing = Array.from(this.terminals.values()).find(t => t.pid === p.pid);
              if (existing) {
                return existing.getMetadata();
              }

              return {
                uuid: '',
                pid: p.pid,
                parentPid: p.parentPid || 0,
                shellType,
                title: p.title || '',
                cwd: '',
                startTime: p.startTime || '',
                status: 'discovered',
                busyState: 'Idle',
                imported: true,
                attachedClients: 0,
                lastActivity: '',
                windowHandle: '0x0'
              };
            });
          resolve(discovered);
        } catch (e) {
          resolve([]);
        }
      });
    });
  }

  public async importTerminal(pid: number, shellType: ShellType, workspaceRoot: string): Promise<TerminalMetadata> {
    // Check path policy
    const pathCheck = this.policyEngine.checkPath(workspaceRoot);
    if (!pathCheck.allowed) {
      throw new Error(`Policy violation: ${pathCheck.reason}`);
    }

    if (!this.isProcessRunning(pid)) {
      throw new Error(`Process with PID ${pid} is not running.`);
    }

    // Verify it isn't already imported
    const existing = Array.from(this.terminals.values()).find(t => t.pid === pid);
    if (existing) {
      return existing.getMetadata();
    }

    const uuid = `term_${Math.random().toString(36).substring(2, 9)}`;
    const term = new InteractiveTerminal(uuid, pid, 0, shellType, true, workspaceRoot);
    
    // Test read to ensure we can attach
    try {
      await term.capture();
    } catch (e: any) {
      term.close();
      throw new Error(`Failed to attach to console of process ${pid}. Ensure it is a valid console process. Details: ${e.message}`);
    }

    this.terminals.set(uuid, term);
    this.saveRegistry();
    this.auditLogger.log({ toolName: 'import_terminal', command: `Import PID ${pid}` });

    return term.getMetadata();
  }

  public createManagedTerminal(shellType: ShellType, name: string, workspaceRoot: string): TerminalMetadata {
    const pathCheck = this.policyEngine.checkPath(workspaceRoot);
    if (!pathCheck.allowed) {
      throw new Error(`Policy violation: ${pathCheck.reason}`);
    }

    let executable = 'powershell.exe';

    switch (shellType) {
      case 'pwsh':
        executable = 'pwsh.exe';
        break;
      case 'cmd':
        executable = 'cmd.exe';
        break;
      case 'wsl':
        executable = 'wsl.exe';
        break;
      case 'powershell':
      default:
        executable = 'powershell.exe';
        break;
    }

    // Spawn detached shell process with new console window using PowerShell Start-Process
    const cmd = `powershell.exe -NoLogo -NonInteractive -ExecutionPolicy Bypass -Command "Start-Process ${executable} -WorkingDirectory '${workspaceRoot}' -PassThru | Select-Object -ExpandProperty Id"`;
    let pid: number;
    try {
      const pidStr = execSync(cmd).toString().trim();
      pid = parseInt(pidStr, 10);
      if (isNaN(pid)) {
        throw new Error(`Invalid PID output: ${pidStr}`);
      }
    } catch (e: any) {
      throw new Error(`Failed to spawn managed terminal process. Details: ${e.message}`);
    }

    const uuid = `term_${Math.random().toString(36).substring(2, 9)}`;
    const term = new InteractiveTerminal(
      uuid,
      pid,
      process.pid,
      shellType,
      false,
      workspaceRoot,
      name
    );

    this.terminals.set(uuid, term);
    this.saveRegistry();
    this.auditLogger.log({ toolName: 'create_terminal', command: `Create managed ${shellType} PID ${pid}` });

    return term.getMetadata();
  }

  public getTerminal(uuid: string): InteractiveTerminal | undefined {
    return this.terminals.get(uuid);
  }

  public listTerminals(): TerminalMetadata[] {
    return Array.from(this.terminals.values()).map(t => t.getMetadata());
  }

  public detachTerminal(uuid: string): boolean {
    const term = this.terminals.get(uuid);
    if (term) {
      term.close();
      this.terminals.delete(uuid);
      this.saveRegistry();
      this.auditLogger.log({ toolName: 'detach_terminal', command: `Detach ${uuid}` });
      return true;
    }
    return false;
  }

  public closeTerminal(uuid: string): boolean {
    const term = this.terminals.get(uuid);
    if (term) {
      term.close();
      // Also try to terminate process
      try {
        process.kill(term.pid, 'SIGKILL');
      } catch (e) {
        // Ignore
      }
      this.terminals.delete(uuid);
      this.saveRegistry();
      this.auditLogger.log({ toolName: 'close_terminal', command: `Close ${uuid}` });
      return true;
    }
    return false;
  }

  public shutdown() {
    for (const term of this.terminals.values()) {
      term.close();
    }
    this.terminals.clear();
  }
}

export function parseKeyCombination(keyStr: string): { keyCode: number, controlState: number } {
  const parts = keyStr.split('+').map(s => s.trim().toUpperCase());
  let keyCode = 0;
  let controlState = 0;

  for (const part of parts) {
    if (part === 'CTRL') {
      controlState |= 0x0008; // LEFT_CTRL_PRESSED
    } else if (part === 'SHIFT') {
      controlState |= 0x0010; // SHIFT_PRESSED
    } else if (part === 'ALT') {
      controlState |= 0x0002; // LEFT_ALT_PRESSED
    } else {
      switch (part) {
        case 'ENTER': keyCode = 13; break;
        case 'ESCAPE':
        case 'ESC': keyCode = 27; break;
        case 'TAB': keyCode = 9; break;
        case 'BACKSPACE': keyCode = 8; break;
        case 'LEFT':
        case 'ARROWLEFT': keyCode = 37; break;
        case 'UP':
        case 'ARROWUP': keyCode = 38; break;
        case 'RIGHT':
        case 'ARROWRIGHT': keyCode = 39; break;
        case 'DOWN':
        case 'ARROWDOWN': keyCode = 40; break;
        case 'HOME': keyCode = 36; break;
        case 'END': keyCode = 35; break;
        case 'PAGEUP':
        case 'PGUP': keyCode = 33; break;
        case 'PAGEDOWN':
        case 'PGDN': keyCode = 34; break;
        case 'DELETE':
        case 'DEL': keyCode = 46; break;
        default:
          if (part.startsWith('F') && part.length > 1) {
            const fNum = parseInt(part.substring(1));
            if (fNum >= 1 && fNum <= 12) {
              keyCode = 111 + fNum; // F1 is 112
            }
          } else if (part.length === 1) {
            keyCode = part.charCodeAt(0);
          }
          break;
      }
    }
  }

  return { keyCode, controlState };
}
