import { spawn } from 'child_process';

export interface SystemProcess {
  pid: number;
  name: string;
  cpu?: number;
  workingSet?: number; // RAM in bytes
  responding: boolean;
  description: string;
}

export class ProcessRouter {
  
  public listProcesses(): Promise<SystemProcess[]> {
    return new Promise((resolve) => {
      // Query process information using PowerShell
      const script = `
Get-Process | ForEach-Object {
  $cpuVal = 0;
  if ($_.CPU -ne $null) { $cpuVal = [Math]::Round($_.CPU, 1) };
  $descVal = "";
  if ($_.Description -ne $null) { $descVal = $_.Description };
  [PSCustomObject]@{
    pid = $_.Id;
    name = $_.ProcessName;
    cpu = $cpuVal;
    workingSet = $_.WorkingSet64;
    responding = $_.Responding;
    description = $descVal;
  }
} | ConvertTo-Json
`.trim().replace(/\r?\n/g, ' ');

      const proc = spawn('powershell.exe', ['-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { shell: false });
      let stdout = '';
      let stderr = '';
      
      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code !== 0 || !stdout.trim()) {
          console.error(`Get-Process exited with code ${code}. Stderr:`, stderr);
          resolve([]);
          return;
        }

        try {
          const parsed = JSON.parse(stdout);
          const rawList = Array.isArray(parsed) ? parsed : [parsed];
          const list = rawList
            .filter((p: any) => p && typeof p.pid === 'number')
            .map((p: any) => ({
              pid: p.pid,
              name: p.name || '',
              cpu: p.cpu || 0,
              workingSet: p.workingSet || 0,
              responding: p.responding !== false,
              description: p.description || ''
            }));
          resolve(list);
        } catch (e) {
          console.error('Failed to parse process list JSON:', e);
          resolve([]);
        }
      });
    });
  }

  public killProcess(pid: number, force = true): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const args = force ? ['/F', '/PID', pid.toString()] : ['/PID', pid.toString()];
      const proc = spawn('taskkill', args, { shell: false });
      let stderr = '';

      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) {
          resolve({ success: true });
        } else {
          resolve({ success: false, error: stderr.trim() || `Exit code ${code}` });
        }
      });
    });
  }

  public startProcess(executable: string, args: string[] = [], cwd?: string): Promise<{ success: boolean; pid?: number; error?: string }> {
    return new Promise((resolve) => {
      try {
        const proc = spawn(executable, args, {
          cwd,
          detached: true,
          stdio: 'ignore',
          shell: true // Safe since we run explicitly defined command parts
        });

        proc.unref();

        if (proc.pid) {
          resolve({ success: true, pid: proc.pid });
        } else {
          resolve({ success: false, error: 'Process spawned but PID is undefined' });
        }
      } catch (e: any) {
        resolve({ success: false, error: e.message || 'Spawn error' });
      }
    });
  }

  public async getHungProcesses(): Promise<SystemProcess[]> {
    const all = await this.listProcesses();
    return all.filter(p => !p.responding);
  }
}
