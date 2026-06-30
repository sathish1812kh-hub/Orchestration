import { InteractiveTerminal, TerminalManager } from './terminalManager';
import { PromptProfileRegistry, PromptProfile } from './promptProfiles';

export interface PromptDetectionResult {
  stable: boolean;
  state: string;
  matchedProfile?: string;
  matchedPrompt?: string;
  cleanBuffer: string;
  cursorX: number;
  cursorY: number;
  cols: number;
  rows: number;
  durationSinceLastOutput: number;
  userInputRequired: boolean;
}

export class AnsiParser {
  private static readonly ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;

  public static stripAnsi(text: string): string {
    const noNulls = text.replace(/\0/g, '');
    return noNulls.replace(this.ansiRegex, '');
  }

  /**
   * Cleans trailing empty spaces per line and normalizes carriage returns.
   */
  public static normalizeScreenText(text: string): string {
    const cleanAnsi = this.stripAnsi(text);
    return cleanAnsi
      .split('\n')
      .map(line => line.trimEnd())
      .join('\n')
      .trimEnd();
  }
}

export class PromptDetectionEngine {
  private profileRegistry: PromptProfileRegistry;
  private terminalManager: TerminalManager;
  
  // Track last seen output to measure timeout/idle delays
  private lastOutputHashes = new Map<string, { hash: string; timestamp: number }>();

  constructor(terminalManager: TerminalManager, profileRegistry: PromptProfileRegistry) {
    this.terminalManager = terminalManager;
    this.profileRegistry = profileRegistry;
  }

  public getRegistry(): PromptProfileRegistry {
    return this.profileRegistry;
  }

  /**
   * Captures output twice and waits for the screen buffer to stabilize.
   */
  public async detectPrompt(
    terminalUuid: string,
    stabilizationDelay = 50
  ): Promise<PromptDetectionResult> {
    const term = this.terminalManager.getTerminal(terminalUuid);
    if (!term) {
      throw new Error(`Terminal session ${terminalUuid} not found.`);
    }

    // Capture 1
    const cap1 = await term.capture(false);
    const text1 = AnsiParser.normalizeScreenText(cap1.visible);

    // Stabilization wait
    await new Promise(resolve => setTimeout(resolve, stabilizationDelay));

    // Capture 2
    const cap2 = await term.capture(false);
    const text2 = AnsiParser.normalizeScreenText(cap2.visible);

    const isStable = (text1 === text2) && 
                     (cap1.cursorX === cap2.cursorX) && 
                     (cap1.cursorY === cap2.cursorY);

    const cleanBuffer = text2;
    const lines = cleanBuffer.split('\n');
    const lastLine = lines[lines.length - 1] || '';

    // Calculate duration since last change
    const currentHash = `${text2}_${cap2.cursorX}_${cap2.cursorY}`;
    const now = Date.now();
    const lastState = this.lastOutputHashes.get(terminalUuid);

    let durationSinceLastOutput = 0;
    if (lastState) {
      if (lastState.hash === currentHash) {
        durationSinceLastOutput = now - lastState.timestamp;
      } else {
        this.lastOutputHashes.set(terminalUuid, { hash: currentHash, timestamp: now });
      }
    } else {
      this.lastOutputHashes.set(terminalUuid, { hash: currentHash, timestamp: now });
    }

    // Run active profiles detection
    let matchedProfile: PromptProfile | undefined;
    let matchedPrompt = '';
    let userInputRequired = false;

    const enabledProfiles = this.profileRegistry.listProfiles().filter(p => p.enabled);
    
    // Sort profiles so specific shell profiles are evaluated before generic REPLs
    const sortedProfiles = [...enabledProfiles].sort((a, b) => {
      if (a.shellType !== 'any' && b.shellType === 'any') return -1;
      if (a.shellType === 'any' && b.shellType !== 'any') return 1;
      return 0;
    });

    for (const profile of sortedProfiles) {
      const regex = new RegExp(profile.promptRegex);
      if (regex.test(lastLine)) {
        matchedProfile = profile;
        matchedPrompt = lastLine;
        break;
      }
    }

    // Check for password or input required
    const passwordProfile = enabledProfiles.find(p => p.name === 'password_prompt');
    if (passwordProfile) {
      const pwRegex = new RegExp(passwordProfile.promptRegex);
      if (pwRegex.test(lastLine)) {
        userInputRequired = true;
      }
    }

    // State analysis
    let state = 'Running';
    if (!term.getMetadata().status.includes('active')) {
      state = 'Closed';
    } else if (!isStable) {
      state = 'Streaming';
    } else if (userInputRequired) {
      state = 'User Input Required';
    } else if (matchedProfile) {
      state = 'Prompt Ready';
      term.busyState = 'Prompt Ready';
    } else {
      // Stable but no prompt matched
      state = 'Waiting';
      term.busyState = 'Idle';
    }

    // Check busy indicators on the last few lines
    if (state === 'Waiting' || state === 'Prompt Ready') {
      const recentText = lines.slice(-5).join('\n');
      if (matchedProfile) {
        for (const busy of matchedProfile.busyIndicators) {
          if (recentText.includes(busy)) {
            state = 'Running';
            term.busyState = 'Running';
          }
        }
      }
    }

    return {
      stable: isStable,
      state,
      matchedProfile: matchedProfile?.name,
      matchedPrompt: matchedPrompt || undefined,
      cleanBuffer,
      cursorX: cap2.cursorX,
      cursorY: cap2.cursorY,
      cols: cap2.cols,
      rows: cap2.rows,
      durationSinceLastOutput,
      userInputRequired
    };
  }

  /**
   * Blocks until terminal prompt stabilizes and matches a profile, or timeout is hit.
   */
  public async waitPrompt(
    terminalUuid: string,
    timeoutMs = 15000,
    checkInterval = 200
  ): Promise<PromptDetectionResult> {
    const start = Date.now();
    
    while (Date.now() - start < timeoutMs) {
      const res = await this.detectPrompt(terminalUuid, 50);
      if (res.stable && (res.state === 'Prompt Ready' || res.state === 'User Input Required')) {
        return res;
      }
      await new Promise(resolve => setTimeout(resolve, checkInterval));
    }

    // If we timed out, run a final detection and return it marked as timeout
    const finalRes = await this.detectPrompt(terminalUuid, 50);
    if (finalRes.state === 'Running' || finalRes.state === 'Streaming') {
      finalRes.state = 'Blocked'; // Command is hanging
    }
    return finalRes;
  }
}
