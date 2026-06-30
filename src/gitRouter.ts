import { spawn } from 'child_process';
import * as path from 'path';
import { PolicyEngine } from './policyEngine';

export class GitRouter {
  private policyEngine: PolicyEngine;

  constructor(policyEngine: PolicyEngine) {
    this.policyEngine = policyEngine;
  }

  public executeGit(
    repoPath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const resolvedPath = path.resolve(repoPath);
      const pathCheck = this.policyEngine.checkPath(resolvedPath);
      if (!pathCheck.allowed) {
        return reject(new Error(`Policy violation: ${pathCheck.reason}`));
      }

      // Check if git reset --hard or other destructive arguments are run
      const fullCmdString = `git ${args.join(' ')}`;
      const cmdCheck = this.policyEngine.checkCommand(fullCmdString);
      if (!cmdCheck.allowed) {
        return reject(new Error(`Policy violation: ${cmdCheck.reason}`));
      }

      const proc = spawn('git', args, {
        cwd: resolvedPath,
        shell: false
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (d) => { stdout += d.toString(); });
      proc.stderr.on('data', (d) => { stderr += d.toString(); });

      proc.on('close', (code) => {
        resolve({
          stdout,
          stderr,
          exitCode: code || 0
        });
      });

      proc.on('error', (err) => {
        reject(err);
      });
    });
  }
}
