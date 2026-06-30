import * as path from 'path';
import { PolicyDecision, Configuration } from './types';

export class PolicyEngine {
  private config: Configuration;

  constructor(config: Configuration) {
    this.config = config;
  }

  updateConfig(config: Configuration) {
    this.config = config;
  }

  /**
   * Validates if a command is allowed to run.
   */
  public checkCommand(command: string): PolicyDecision {
    const trimmedCmd = command.trim().toLowerCase();

    // Check blocked commands
    for (const blocked of this.config.blockedCommands) {
      if (trimmedCmd.includes(blocked.toLowerCase())) {
        return {
          allowed: false,
          reason: `Command matches blocked pattern: "${blocked}"`,
          requiresConfirmation: false
        };
      }
    }

    // Check confirmation required commands
    for (const confirmCmd of this.config.confirmationCommands) {
      if (trimmedCmd.includes(confirmCmd.toLowerCase())) {
        return {
          allowed: true,
          reason: `Command requires confirmation: "${confirmCmd}"`,
          requiresConfirmation: true
        };
      }
    }

    return {
      allowed: true,
      reason: 'Command is safe and policy-compliant',
      requiresConfirmation: false
    };
  }

  /**
   * Validates if a file path is allowed to be accessed.
   * Path must be within at least one workspace root and NOT inside any blocked paths.
   */
  public checkPath(targetPath: string): PolicyDecision {
    const resolvedTarget = path.resolve(targetPath);

    // Check if path is blocked
    for (const blocked of this.config.blockedPaths) {
      const resolvedBlocked = path.resolve(blocked);
      if (resolvedTarget.toLowerCase() === resolvedBlocked.toLowerCase() || 
          resolvedTarget.toLowerCase().startsWith(resolvedBlocked.toLowerCase() + path.sep)) {
        return {
          allowed: false,
          reason: `Path is blocked by security policy: "${blocked}"`,
          requiresConfirmation: false
        };
      }
    }

    // Check if path is within workspace roots
    let inWorkspace = false;
    for (const root of this.config.workspaceRoots) {
      const resolvedRoot = path.resolve(root);
      if (resolvedTarget.toLowerCase() === resolvedRoot.toLowerCase() || 
          resolvedTarget.toLowerCase().startsWith(resolvedRoot.toLowerCase() + path.sep)) {
        inWorkspace = true;
        break;
      }
    }

    if (!inWorkspace) {
      return {
        allowed: false,
        reason: `Access denied. Path "${resolvedTarget}" is outside of authorized workspace roots. Authorized roots: ${this.config.workspaceRoots.join(', ')}`,
        requiresConfirmation: true // Let confirmation override workspace check if requested or explicitly gated
      };
    }

    return {
      allowed: true,
      reason: 'Path is safe and policy-compliant',
      requiresConfirmation: false
    };
  }

  /**
   * Validates a general action and description.
   */
  public checkAction(actionName: string, details?: string): PolicyDecision {
    const normalizedAction = actionName.toLowerCase();
    
    if (normalizedAction === 'format' || normalizedAction === 'shutdown') {
      return {
        allowed: false,
        reason: `Action "${actionName}" is blocked by safety policy.`,
        requiresConfirmation: false
      };
    }

    if (normalizedAction.includes('delete') || normalizedAction.includes('kill') || normalizedAction.includes('remove')) {
      return {
        allowed: true,
        reason: `Destructive action "${actionName}" requires confirmation.`,
        requiresConfirmation: true
      };
    }

    return {
      allowed: true,
      reason: 'Action is safe and policy-compliant',
      requiresConfirmation: false
    };
  }
}
