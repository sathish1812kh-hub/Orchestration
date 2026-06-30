import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { ShellType, Session } from './types';
import * as path from 'path';

interface QueuedCommand {
  command: string;
  timeoutMs: number;
  resolve: (value: CommandResult) => void;
  reject: (reason: any) => void;
  startTime: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  cwd: string;
  duration: number;
}

export class PersistentShell {
  public readonly id: string;
  public readonly shellType: ShellType;
  public readonly name: string;
  public readonly workspaceRoot: string;
  
  private process!: ChildProcessWithoutNullStreams;
  private currentCwd: string;
  private status: 'active' | 'suspended' | 'terminated' = 'active';
  private createdAt: Date;
  private lastUsedAt: Date;

  private stdoutBuffer = '';
  private stderrBuffer = '';
  
  private commandQueue: QueuedCommand[] = [];
  private currentCommand: QueuedCommand | null = null;
  private currentCommandId = '';
  private timeoutTimer: NodeJS.Timeout | null = null;

  constructor(id: string, shellType: ShellType, name: string, workspaceRoot: string) {
    this.id = id;
    this.shellType = shellType;
    this.name = name;
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.currentCwd = this.workspaceRoot;
    this.createdAt = new Date();
    this.lastUsedAt = new Date();

    this.startProcess();
  }

  private startProcess() {
    let executable = 'powershell.exe';
    let args: string[] = [];

    switch (this.shellType) {
      case 'pwsh':
        executable = 'pwsh.exe';
        args = ['-NoLogo', '-NoExit', '-Command', '-'];
        break;
      case 'cmd':
        executable = 'cmd.exe';
        args = ['/k'];
        break;
      case 'wsl':
        executable = 'wsl.exe';
        args = [];
        break;
      case 'powershell':
      default:
        executable = 'powershell.exe';
        args = ['-NoLogo', '-NoExit', '-Command', '-'];
        break;
    }

    this.process = spawn(executable, args, {
      cwd: this.currentCwd,
      env: { ...process.env },
      shell: false
    });

    this.process.stdout.on('data', (data) => {
      this.stdoutBuffer += data.toString();
      this.checkCommandCompletion();
    });

    this.process.stderr.on('data', (data) => {
      this.stderrBuffer += data.toString();
      this.checkCommandCompletion();
    });

    this.process.on('close', (code) => {
      this.status = 'terminated';
      if (this.currentCommand) {
        this.currentCommand.reject(new Error(`Shell process terminated with exit code ${code}`));
        this.cleanupCurrentCommand();
      }
    });

    this.process.on('error', (err) => {
      console.error(`Process error on session ${this.id}:`, err);
      if (this.currentCommand) {
        this.currentCommand.reject(err);
        this.cleanupCurrentCommand();
      }
    });

    // Send initial configuration commands
    if (this.shellType === 'cmd') {
      // Turn off command echo so output is cleaner
      this.process.stdin.write('@echo off\r\n');
    }
  }

  public getPid(): number {
    return this.process.pid || 0;
  }

  public getSessionInfo(): Session {
    return {
      id: this.id,
      shellType: this.shellType,
      pid: this.getPid(),
      workspaceRoot: this.workspaceRoot,
      cwd: this.currentCwd,
      name: this.name,
      status: this.status,
      createdAt: this.createdAt.toISOString(),
      lastUsedAt: this.lastUsedAt.toISOString()
    };
  }

  public execute(command: string, timeoutMs = 60000): Promise<CommandResult> {
    this.lastUsedAt = new Date();
    return new Promise<CommandResult>((resolve, reject) => {
      const queued: QueuedCommand = {
        command,
        timeoutMs,
        resolve,
        reject,
        startTime: Date.now()
      };
      this.commandQueue.push(queued);
      this.processQueue();
    });
  }

  private processQueue() {
    if (this.currentCommand || this.commandQueue.length === 0) {
      return;
    }

    this.currentCommand = this.commandQueue.shift()!;
    this.currentCommandId = `cmd_${Math.random().toString(36).substring(2, 9)}`;
    this.currentCommand.startTime = Date.now();

    // Reset stream buffers for the new command
    this.stdoutBuffer = '';
    this.stderrBuffer = '';

    // Write input commands along with custom structured start/end markers
    const cmdInput = this.buildCommandInput(this.currentCommand.command, this.currentCommandId);
    
    // Set timeout timer
    if (this.currentCommand.timeoutMs > 0) {
      this.timeoutTimer = setTimeout(() => {
        if (this.currentCommand) {
          const timeoutError = new Error(`Command execution timed out after ${this.currentCommand.timeoutMs}ms`);
          this.currentCommand.reject(timeoutError);
          // Terminate the shell session if a command hangs
          this.terminate();
          this.startProcess(); // Respawn process to keep session alive
          this.cleanupCurrentCommand();
        }
      }, this.currentCommand.timeoutMs);
    }

    this.process.stdin.write(cmdInput);
  }

  private buildCommandInput(command: string, cmdId: string): string {
    const isPowershell = this.shellType === 'powershell' || this.shellType === 'pwsh';

    if (isPowershell) {
      return `
[Console]::Out.WriteLine("START_" + "${cmdId}")
${command}
[Console]::Out.WriteLine("CWD:" + $PWD.Path)
$exitCode = 0; if ($LASTEXITCODE -ne $null) { $exitCode = $LASTEXITCODE } else { if (-not $?) { $exitCode = 1 } }
[Console]::Out.WriteLine("EXIT_CODE:" + $exitCode)
[Console]::Out.WriteLine("END_" + "${cmdId}")
`.trim() + '\r\n';
    } else if (this.shellType === 'cmd') {
      return `
echo START_${cmdId}
${command}
echo CWD:%CD%
echo EXIT_CODE:%ERRORLEVEL%
echo END_${cmdId}
`.trim() + '\r\n';
    } else { // wsl / bash
      return `
echo "START_${cmdId}"
${command}
echo "CWD:$(pwd)"
echo "EXIT_CODE:$?"
echo "END_${cmdId}"
`.trim() + '\n';
    }
  }

  private checkCommandCompletion() {
    if (!this.currentCommand) return;

    const cmdId = this.currentCommandId;
    const stdout = this.stdoutBuffer;

    const outStartMarker = `START_${cmdId}`;
    const outEndMarker = `END_${cmdId}`;

    const hasStdoutStart = stdout.includes(outStartMarker);
    const hasStdoutEnd = stdout.includes(outEndMarker);

    if (hasStdoutStart && hasStdoutEnd) {
      // Clear timeout
      if (this.timeoutTimer) {
        clearTimeout(this.timeoutTimer);
        this.timeoutTimer = null;
      }

      // Parse stdout
      const startIndex = stdout.indexOf(outStartMarker) + outStartMarker.length;
      const endIndex = stdout.indexOf(outEndMarker);
      const innerContent = stdout.substring(startIndex, endIndex);

      // Extract CWD and Exit Code
      let parsedCwd = this.currentCwd;
      const cwdMatch = innerContent.match(/\r?\nCWD:([^\r\n]+)/);
      if (cwdMatch) {
        parsedCwd = cwdMatch[1].trim();
        this.currentCwd = parsedCwd;
      }

      let exitCode = 0;
      const exitCodeMatch = innerContent.match(/\r?\nEXIT_CODE:(-?\d+)/);
      if (exitCodeMatch) {
        exitCode = parseInt(exitCodeMatch[1].trim(), 10);
      }

      // Strip CWD and EXIT_CODE lines from output
      let commandStdout = innerContent
        .replace(/\r?\nCWD:[^\r\n]+/, '')
        .replace(/\r?\nEXIT_CODE:-?\d+/, '');

      // Clean commandStdout from leading/trailing newlines
      commandStdout = commandStdout.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

      // Parse stderr
      let commandStderr = this.stderrBuffer;
      commandStderr = commandStderr.replace(/^\r?\n/, '').replace(/\r?\n$/, '');

      const result: CommandResult = {
        stdout: commandStdout,
        stderr: commandStderr,
        exitCode,
        cwd: parsedCwd,
        duration: Date.now() - this.currentCommand.startTime
      };

      const resolveFn = this.currentCommand.resolve;
      this.cleanupCurrentCommand();
      resolveFn(result);

      // Process next command in the queue
      this.processQueue();
    }
  }

  private cleanupCurrentCommand() {
    this.currentCommand = null;
    this.currentCommandId = '';
    if (this.timeoutTimer) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }

  public terminate() {
    this.status = 'terminated';
    try {
      this.process.kill();
    } catch (e) {
      // Ignore errors if process is already dead
    }
  }
}

export class SessionRegistry {
  private sessions = new Map<string, PersistentShell>();
  private defaultWorkspaceRoot: string;

  constructor(defaultWorkspaceRoot: string) {
    this.defaultWorkspaceRoot = defaultWorkspaceRoot;
  }

  public createSession(shellType: ShellType, name: string, workspaceRoot?: string): Session {
    const id = `session_${Math.random().toString(36).substring(2, 9)}`;
    const root = workspaceRoot || this.defaultWorkspaceRoot;
    const session = new PersistentShell(id, shellType, name, root);
    this.sessions.set(id, session);
    return session.getSessionInfo();
  }

  public getSession(id: string): PersistentShell | undefined {
    return this.sessions.get(id);
  }

  public listSessions(): Session[] {
    return Array.from(this.sessions.values()).map(s => s.getSessionInfo());
  }

  public killSession(id: string): boolean {
    const session = this.sessions.get(id);
    if (session) {
      session.terminate();
      this.sessions.delete(id);
      return true;
    }
    return false;
  }

  public killAll(): void {
    for (const session of this.sessions.values()) {
      session.terminate();
    }
    this.sessions.clear();
  }

  /**
   * Attempts to detect active shell processes on Windows and maps window focus.
   * Leverages PowerShell to query the foreground window and maps it to a session.
   */
  public async detectActiveShell(): Promise<{
    activeProcess: { id: number; name: string; title: string } | null;
    matchedSession: Session | null;
    allSessions: Session[];
  }> {
    const allSessions = this.listSessions();
    let activeProcess = null;

    try {
      // Running the user32.dll script synchronously via shell
      const command = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class User32 { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId); }'; 
$hwnd = [User32]::GetForegroundWindow(); 
$processId = 0; 
[User32]::GetWindowThreadProcessId($hwnd, [ref]$processId); 
Get-Process -Id $processId | Select-Object -Property Id, ProcessName, MainWindowTitle | ConvertTo-Json
`.trim().replace(/\r?\n/g, ' ');

      const res = await this.runOneOffPowershell(command);
      if (res.exitCode === 0 && res.stdout.trim()) {
        const parsed = JSON.parse(res.stdout);
        activeProcess = {
          id: parsed.Id,
          name: parsed.ProcessName,
          title: parsed.MainWindowTitle || ''
        };
      }
    } catch (e) {
      // Ignore or log error
    }

    // Try to match active process with a session by Process ID or title
    let matchedSession = null;
    if (activeProcess) {
      // Match by pid (wait, the process ID returned is the focused terminal shell or window host process, 
      // which might be WindowsTerminal or powershell.exe. Let's see if it matches any session's pid or any child process of it).
      matchedSession = allSessions.find(s => s.pid === activeProcess!.id) || null;

      if (!matchedSession) {
        // Also check if any session pid is a child of the active process PID, or vice versa
        // Or if the window title has workspace path / folder name
        for (const session of allSessions) {
          const workspaceDirName = path.basename(session.workspaceRoot).toLowerCase();
          if (activeProcess!.title.toLowerCase().includes(workspaceDirName)) {
            matchedSession = session;
            break;
          }
        }
      }
    }

    // Fallback selection: last used active session or first active session
    if (!matchedSession && allSessions.length > 0) {
      const sorted = [...allSessions].sort((a, b) => b.lastUsedAt.localeCompare(a.lastUsedAt));
      matchedSession = sorted[0];
    }

    return {
      activeProcess,
      matchedSession,
      allSessions
    };
  }

  private runOneOffPowershell(cmd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn('powershell.exe', ['-NoLogo', '-NonInteractive', '-Command', cmd], { shell: false });
      let stdout = '';
      let stderr = '';
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode: exitCode || 0 });
      });
    });
  }
}
