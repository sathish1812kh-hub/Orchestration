import * as vm from 'vm';
import * as fs from 'fs';
import * as path from 'path';
import { EventBus } from './eventBus';
import { TerminalManager } from './terminalManager';
import { WorkflowEngine } from './workflowEngine';
import { ExecutionDispatcher } from './dispatcher';
import { AgentManager } from './agentManager';
import { AutonomousOrchestrator } from './orchestrator';
import { PolicyEngine } from './policyEngine';
import { AuditLogger } from './auditLogger';

export interface PluginManifest {
  pluginId: string;
  name: string;
  version: string;
  author: string;
  description: string;
  sdkVersion: string;
  platformCompatibility: string[];
  dependencies: string[];
  permissions: string[]; // e.g. ["terminal.write", "event.publish"]
  extensionPoints: string[];
  configurationSchema?: any;
}

export interface PluginState {
  pluginId: string;
  manifest: PluginManifest;
  status: 'Installed' | 'Loaded' | 'Initialized' | 'Running' | 'Paused' | 'Stopped' | 'Failed' | 'Unloaded';
  error?: string;
  codeString?: string;
  sandboxContext?: vm.Context;
  config?: any;
}

export class CapabilityGateway {
  private pluginId: string;
  private allowedPermissions: string[];
  private auditLogger: AuditLogger;
  private policyEngine: PolicyEngine;

  constructor(pluginId: string, allowedPermissions: string[], auditLogger: AuditLogger, policyEngine: PolicyEngine) {
    this.pluginId = pluginId;
    this.allowedPermissions = allowedPermissions;
    this.auditLogger = auditLogger;
    this.policyEngine = policyEngine;
  }

  public check(permission: string, target?: string) {
    if (!this.allowedPermissions.includes(permission)) {
      throw new Error(`PermissionDenied: Plugin ${this.pluginId} missing required permission: ${permission}`);
    }

    if (this.policyEngine && target) {
      // Evaluate command checks (e.g. format: "cmd.exe" or paths)
      const allowed = this.policyEngine.checkCommand(target).allowed;
      if (!allowed) {
        throw new Error(`PolicyViolation: Action ${permission} on ${target} rejected by Policy Engine`);
      }
    }

    if (this.auditLogger) {
      this.auditLogger.log({
        toolName: `plugin:${this.pluginId}`,
        command: `${permission} ${target || ''}`
      });
    }
  }
}

export function isProtectedPath(targetPath: string): boolean {
  const resolved = path.resolve(targetPath).toLowerCase();
  const protectedPrefixes = [
    'c:\\windows',
    'c:\\program files',
    'c:\\program files (x86)'
  ];
  return protectedPrefixes.some(prefix => 
    resolved === prefix || resolved.startsWith(prefix + path.sep)
  );
}

export function resolvePluginDirectory(): string {
  if (process.env.PLUGIN_DIRECTORY) {
    return path.resolve(process.env.PLUGIN_DIRECTORY);
  }

  if (process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, 'NGROK-MCP', 'plugins');
  }

  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (homeDir) {
    return path.join(homeDir, '.local', 'share', 'NGROK-MCP', 'plugins');
  }

  return path.join(__dirname, '..', 'plugins');
}

export class PluginFramework {
  private eventBus: EventBus;
  private terminalManager: TerminalManager;
  private workflowEngine: WorkflowEngine;
  private dispatcher: ExecutionDispatcher;
  private agentManager: AgentManager;
  private orchestrator: AutonomousOrchestrator;
  private policyEngine: PolicyEngine;
  private auditLogger: AuditLogger;

  private registry = new Map<string, PluginState>();
  private pluginsDir: string = '';
  private enabled: boolean = true;

  constructor(
    eventBus: EventBus,
    terminalManager: TerminalManager,
    workflowEngine: WorkflowEngine,
    dispatcher: ExecutionDispatcher,
    agentManager: AgentManager,
    orchestrator: AutonomousOrchestrator,
    policyEngine: PolicyEngine,
    auditLogger: AuditLogger,
    pluginsDir?: string
  ) {
    this.eventBus = eventBus;
    this.terminalManager = terminalManager;
    this.workflowEngine = workflowEngine;
    this.dispatcher = dispatcher;
    this.agentManager = agentManager;
    this.orchestrator = orchestrator;
    this.policyEngine = policyEngine;
    this.auditLogger = auditLogger;

    let targetDir = '';
    try {
      if (process.env.PLUGIN_DIRECTORY) {
        targetDir = path.resolve(process.env.PLUGIN_DIRECTORY);
      } else if (pluginsDir && !pluginsDir.includes('System32') && !isProtectedPath(pluginsDir)) {
        targetDir = path.resolve(pluginsDir);
      } else {
        targetDir = resolvePluginDirectory();
      }

      console.error(`Plugin directory:\n\nResolved path:\n${targetDir}`);

      if (isProtectedPath(targetDir)) {
        throw new Error(`PermissionDenied: Path "${targetDir}" is a protected Windows system directory.`);
      }

      // Safe creation block
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      // Check write permissions
      const testFile = path.join(targetDir, `.write_test_${Math.random()}`);
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);

      this.pluginsDir = targetDir;
      console.error('Writable:\ntrue\n');
    } catch (err: any) {
      console.error('Writable:\nfalse\n');
      console.error('Plugin Framework failed to initialize:', err.message);
      console.error('Disabling Plugin Framework... MCP server will continue starting.');
      this.enabled = false;
      this.pluginsDir = '';
    }
  }

  public async registerPlugin(manifest: PluginManifest, codeString: string): Promise<PluginState> {
    // Validate manifest fields
    this.validateManifest(manifest);
    this.resolveDependencies(manifest);

    const state: PluginState = {
      pluginId: manifest.pluginId,
      manifest,
      codeString,
      status: 'Installed'
    };

    this.registry.set(manifest.pluginId, state);
    await this.publishLifecycleEvent('PluginLoaded', state);

    return state;
  }

  private validateManifest(manifest: PluginManifest) {
    if (!manifest.pluginId || !manifest.name || !manifest.version || !manifest.sdkVersion) {
      throw new Error('InvalidManifest: Missing required metadata identification fields');
    }
  }

  private resolveDependencies(manifest: PluginManifest) {
    // Check for cycles or missing dependencies
    const visited = new Set<string>();
    const stack = new Set<string>();

    const check = (pId: string, deps: string[]) => {
      stack.add(pId);
      for (const dep of deps) {
        if (stack.has(dep)) {
          throw new Error(`CyclicDependency: Loop detected containing ${dep}`);
        }
        if (!visited.has(dep)) {
          const depPlugin = this.registry.get(dep);
          if (depPlugin) {
            check(dep, depPlugin.manifest.dependencies);
          }
        }
      }
      stack.delete(pId);
      visited.add(pId);
    };

    check(manifest.pluginId, manifest.dependencies);
  }

  public async loadPlugin(pluginId: string): Promise<boolean> {
    const state = this.registry.get(pluginId);
    if (!state || state.status !== 'Installed') return false;

    try {
      // Build capability gateway
      const gateway = new CapabilityGateway(
        pluginId,
        state.manifest.permissions,
        this.auditLogger,
        this.policyEngine
      );

      // Create isolated SDK injector wrapper
      const injectedSdk = this.createSdkWrapper(gateway);

      // Setup Node VM sandbox environment context
      const sandbox = {
        console: {
          log: (...args: any[]) => console.log(`[Plugin:${pluginId}]`, ...args),
          error: (...args: any[]) => console.error(`[Plugin:${pluginId}]`, ...args)
        },
        setTimeout,
        setInterval,
        clearTimeout,
        clearInterval,
        sdk: injectedSdk,
        pluginResult: { loaded: false, message: '' }
      };

      const context = vm.createContext(sandbox);
      state.sandboxContext = context;

      // Compile and execute plugin script inside VM sandbox
      const script = new vm.Script(state.codeString || '');
      script.runInContext(context);

      state.status = 'Loaded';
      await this.publishLifecycleEvent('PluginLoaded', state);
      return true;

    } catch (err: any) {
      state.status = 'Failed';
      state.error = err.message;
      await this.publishLifecycleEvent('PluginFailed', state, { error: err.message });
      return false;
    }
  }

  public async startPlugin(pluginId: string): Promise<boolean> {
    const state = this.registry.get(pluginId);
    if (!state || state.status !== 'Loaded') return false;

    try {
      const context = state.sandboxContext;
      if (context) {
        // Trigger VM sandbox start hooks
        const startHook = context.start;
        if (typeof startHook === 'function') {
          startHook();
        }
      }
      state.status = 'Running';
      await this.publishLifecycleEvent('PluginLoaded', state); // Updates current state
      return true;
    } catch (err: any) {
      state.status = 'Failed';
      state.error = err.message;
      await this.publishLifecycleEvent('PluginFailed', state, { error: err.message });
      return false;
    }
  }

  public async unloadPlugin(pluginId: string): Promise<boolean> {
    const state = this.registry.get(pluginId);
    if (!state || (state.status === 'Unloaded' || state.status === 'Installed')) return false;

    // Trigger sandbox shutdown hook if present
    try {
      const context = state.sandboxContext;
      if (context) {
        const stopHook = context.stop;
        if (typeof stopHook === 'function') {
          stopHook();
        }
      }
    } catch (_) {}

    state.sandboxContext = undefined;
    state.status = 'Unloaded';
    await this.publishLifecycleEvent('PluginUnloaded', state);
    return true;
  }

  public async reloadPlugin(pluginId: string): Promise<boolean> {
    const state = this.registry.get(pluginId);
    if (!state) return false;

    const originalCode = state.codeString || '';
    const originalManifest = state.manifest;

    await this.unloadPlugin(pluginId);
    state.status = 'Installed';
    state.codeString = originalCode;
    state.manifest = originalManifest;

    const loaded = await this.loadPlugin(pluginId);
    if (loaded) {
      return await this.startPlugin(pluginId);
    }
    return false;
  }

  public getPlugin(pluginId: string): PluginState | undefined {
    return this.registry.get(pluginId);
  }

  public listPlugins(): PluginState[] {
    return Array.from(this.registry.values());
  }

  private createSdkWrapper(gateway: CapabilityGateway) {
    return {
      terminal: {
        write: async (termId: string, cmd: string) => {
          gateway.check('terminal.write', cmd);
          const term = this.terminalManager.getTerminal(termId);
          if (!term) throw new Error('TerminalNotFound');
          await term.write(cmd);
          await term.sendKey(13, 0); // Enter
        },
        capture: async (termId: string) => {
          gateway.check('terminal.read', termId);
          const term = this.terminalManager.getTerminal(termId);
          if (!term) throw new Error('TerminalNotFound');
          return await term.capture();
        }
      },
      event: {
        publish: async (evt: any) => {
          gateway.check('event.publish');
          await this.eventBus.publish(evt);
        }
      }
    };
  }

  private async publishLifecycleEvent(type: string, state: PluginState, payload: any = {}) {
    try {
      await this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_pl_${Math.random().toString(36).substring(2, 9)}`,
        eventType: type,
        eventCategory: 'System',
        timestamp: Date.now(),
        severity: state.status === 'Failed' ? 'Error' : 'Information',
        tags: ['plugin', state.pluginId],
        payload: {
          pluginId: state.pluginId,
          status: state.status,
          manifest: state.manifest,
          ...payload
        },
        metadata: { pluginId: state.pluginId },
        correlationId: `corr_pl_${state.pluginId}`,
        parentEventId: 'root'
      });
    } catch (_) {}
  }
}
