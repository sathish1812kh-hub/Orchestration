import { ShellType } from './types';

export interface PromptProfile {
  name: string;
  shellType: ShellType | 'any';
  promptRegex: string; // Stored as string, compiled dynamically
  busyIndicators: string[];
  errorIndicators: string[];
  completionIndicators: string[];
  continuationPrompt?: string;
  multilinePrompt?: string;
  enabled: boolean;
}

export class PromptProfileRegistry {
  private profiles = new Map<string, PromptProfile>();

  constructor() {
    this.registerDefaultProfiles();
  }

  private registerDefaultProfiles() {
    // 1. Windows PowerShell
    this.register({
      name: 'powershell',
      shellType: 'powershell',
      promptRegex: '^PS [A-Z]:\\\\([^>\\r\\n]*>)\\s*$',
      busyIndicators: ['Running...', 'Processing...'],
      errorIndicators: ['CategoryInfo', 'FullyQualifiedErrorId', 'Error:'],
      completionIndicators: [],
      enabled: true
    });

    // 2. PowerShell 7 (pwsh)
    this.register({
      name: 'pwsh',
      shellType: 'pwsh',
      promptRegex: '^PS [A-Z]:\\\\([^>\\r\\n]*>)\\s*$',
      busyIndicators: ['Running...', 'Processing...'],
      errorIndicators: ['CategoryInfo', 'FullyQualifiedErrorId', 'Error:'],
      completionIndicators: [],
      enabled: true
    });

    // 3. Command Prompt (cmd)
    this.register({
      name: 'cmd',
      shellType: 'cmd',
      promptRegex: '^[A-Z]:\\\\([^>\\r\\n]*>)\\s*$',
      busyIndicators: [],
      errorIndicators: ['is not recognized as an internal or external command', 'Access is denied'],
      completionIndicators: [],
      enabled: true
    });

    // 4. WSL / Bash
    this.register({
      name: 'wsl',
      shellType: 'wsl',
      promptRegex: '[\\w.-]+@[\\w.-]+:.*[$#]\\s*$',
      busyIndicators: ['loading...', 'compiling...'],
      errorIndicators: ['command not found', 'Permission denied', 'Error:'],
      completionIndicators: [],
      enabled: true
    });

    // 5. Python REPL
    this.register({
      name: 'python_repl',
      shellType: 'any',
      promptRegex: '^>>>\\s*$',
      busyIndicators: [],
      errorIndicators: ['Traceback (most recent call last):', 'SyntaxError:', 'NameError:'],
      completionIndicators: [],
      continuationPrompt: '... ',
      enabled: true
    });

    // 6. Node.js REPL
    this.register({
      name: 'node_repl',
      shellType: 'any',
      promptRegex: '^>\\s*$',
      busyIndicators: [],
      errorIndicators: ['Thrown:', 'Uncaught', 'SyntaxError:'],
      completionIndicators: [],
      continuationPrompt: '... ',
      enabled: true
    });

    // 7. Git Passphrase / Password Prompt
    this.register({
      name: 'password_prompt',
      shellType: 'any',
      promptRegex: '(?:password|passphrase|token|key):\\s*$',
      busyIndicators: [],
      errorIndicators: ['Permission denied', 'fatal: Authentication failed'],
      completionIndicators: [],
      enabled: true
    });

    // 8. Claude Code CLI / Codex CLI / Antigravity CLI
    this.register({
      name: 'cli_tools',
      shellType: 'any',
      promptRegex: '(?:Claude|Codex|Antigravity).*?>\\s*$',
      busyIndicators: ['thinking...', 'analyzing...'],
      errorIndicators: ['failed', 'error'],
      completionIndicators: [],
      enabled: true
    });
  }

  public register(profile: Omit<PromptProfile, 'enabled'> & { enabled?: boolean }): void {
    this.profiles.set(profile.name, {
      ...profile,
      enabled: profile.enabled !== false
    });
  }

  public unregister(name: string): boolean {
    return this.profiles.delete(name);
  }

  public getProfile(name: string): PromptProfile | undefined {
    return this.profiles.get(name);
  }

  public listProfiles(): PromptProfile[] {
    return Array.from(this.profiles.values());
  }

  public enableProfile(name: string): boolean {
    const profile = this.profiles.get(name);
    if (profile) {
      profile.enabled = true;
      return true;
    }
    return false;
  }

  public disableProfile(name: string): boolean {
    const profile = this.profiles.get(name);
    if (profile) {
      profile.enabled = false;
      return true;
    }
    return false;
  }
}
