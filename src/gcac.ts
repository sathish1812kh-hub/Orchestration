import { InteractiveProcessConnector, IpcrConfig } from './ipcr';
import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export interface GcacProfile {
  name: string;
  executablePath: string;
  args: string[];
  versionCommand: string;
  env?: Record<string, string>;
  promptRegex: string;
  completionStrategy: 'regex' | 'idle' | 'terminator';
  completionPattern?: string;
  idleTimeoutMs?: number;
  capabilities: Array<{ capabilityId: string; version: string }>;
  thinkingMarker?: string;
  errorMarker?: string;
}

export class GenericCliAiConnector extends InteractiveProcessConnector {
  private profile?: GcacProfile;

  constructor(
    eventBus: EventBus,
    observability: ObservabilityPlatform
  ) {
    super(eventBus, observability);
  }

  public getProfile() {
    return this.profile;
  }

  public loadProfile(profile: GcacProfile) {
    this.profile = profile;
  }

  // Implementation of abstract IPCR parser hooks
  protected parseBanner(banner: string): void {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: `evt_banner_${Date.now()}`,
      eventType: 'ConnectorBannerParsed',
      eventCategory: 'System',
      timestamp: Date.now(),
      severity: 'Information',
      tags: ['connector', this.profile?.name || 'gcac'],
      payload: { banner },
      metadata: {},
      correlationId: this.sessionId || '',
      parentEventId: 'root'
    }).catch(() => {});
  }

  protected filterOutput(chunk: string): string {
    if (!this.profile) return chunk;
    // Strip thinking markers if specified
    if (this.profile.thinkingMarker) {
      return chunk.replace(new RegExp(this.profile.thinkingMarker, 'g'), '');
    }
    return chunk;
  }

  protected detectError(chunk: string): string | null {
    if (!this.profile || !this.profile.errorMarker) return null;
    const regex = new RegExp(this.profile.errorMarker);
    if (regex.test(chunk)) {
      return `ErrorDetected: ${chunk}`;
    }
    return null;
  }

  public capabilities(): Array<{ capabilityId: string; version: string }> {
    return this.profile?.capabilities || [];
  }

  public async initializeGcac(profile: GcacProfile, cwd: string): Promise<void> {
    this.profile = profile;
    const ipcrConfig: IpcrConfig = {
      executablePath: profile.executablePath,
      args: profile.args,
      env: profile.env,
      cwd,
      completionStrategy: profile.completionStrategy,
      completionPattern: profile.promptRegex,
      idleTimeoutMs: profile.idleTimeoutMs
    };
    await this.initialize(ipcrConfig);
  }
}
