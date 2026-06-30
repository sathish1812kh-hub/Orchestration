import * as crypto from 'crypto';
import { EventBus } from './eventBus';

export interface ConfigurationItemSchema {
  key: string;
  type: 'string' | 'number' | 'boolean' | 'enum' | 'secret';
  required: boolean;
  default?: any;
  allowedValues?: any[];
  min?: number;
  max?: number;
  regex?: RegExp;
  restartRequired: boolean;
}

export type FeatureFlagState = 'Experimental' | 'Beta' | 'Stable' | 'Deprecated';

export interface FeatureFlag {
  flag: string;
  state: FeatureFlagState;
  enabled: boolean;
}

/**
 * Centered Configuration & Secrets Manager.
 */
export class ConfigurationSecretsManager {
  private eventBus?: EventBus;
  private schema = new Map<string, ConfigurationItemSchema>();
  private activeSnapshot: any = {};
  
  // Layer caches
  private defaults: any = {};
  private platform: any = {};
  private environment: any = {};
  private workspace: any = {};
  private plugin: any = {};
  private overrides: any = {};

  // Watchers
  private watchers = new Map<string, Array<(newVal: any) => void>>();

  // Secrets store (securely encrypted using machine-specific key)
  private secrets = new Map<string, { encrypted: string; iv: string; tag: string }>();
  private encryptionKey: Buffer;

  // Feature flags
  private featureFlags = new Map<string, FeatureFlag>();

  constructor() {
    // Derive a pseudo-DPAPI key unique to this machine/computer name
    const machineId = process.env.COMPUTERNAME || process.env.HOSTNAME || 'antigravity_platform_host';
    this.encryptionKey = crypto.createHash('sha256').update(machineId).digest();

    this.registerDefaultSchemas();
    this.rebuildSnapshot();
  }

  public setEventBus(eventBus: EventBus) {
    this.eventBus = eventBus;
  }

  private registerDefaultSchemas() {
    this.defineSchema({ key: 'platform.port', type: 'number', required: true, default: 3000, min: 1024, max: 65535, restartRequired: true });
    this.defineSchema({ key: 'platform.logLevel', type: 'enum', required: true, default: 'info', allowedValues: ['debug', 'info', 'warn', 'error'], restartRequired: false });
    this.defineSchema({ key: 'runtime.concurrencyLimit', type: 'number', required: true, default: 10, min: 1, max: 50, restartRequired: false });
    this.defineSchema({ key: 'security.sandboxLevel', type: 'enum', required: true, default: 'vm', allowedValues: ['vm', 'container', 'none'], restartRequired: true });
    this.defineSchema({ key: 'performance.maxMemoryLimitMb', type: 'number', required: true, default: 2048, min: 512, restartRequired: false });

    // Prepopulate feature flags
    this.featureFlags.set('experimentalWorkflowEngine', { flag: 'experimentalWorkflowEngine', state: 'Experimental', enabled: false });
    this.featureFlags.set('betaDockerAdapter', { flag: 'betaDockerAdapter', state: 'Beta', enabled: false });
  }

  public defineSchema(item: ConfigurationItemSchema) {
    this.schema.set(item.key, item);
    if (item.default !== undefined) {
      this.setPathValue(this.defaults, item.key, item.default);
    }
  }

  /**
   * Layered configuration precedence rebuild.
   */
  private rebuildSnapshot() {
    const target = {};

    // Apply layers sequentially
    this.deepMerge(target, this.defaults);
    this.deepMerge(target, this.platform);
    this.deepMerge(target, this.environment);
    this.deepMerge(target, this.workspace);
    this.deepMerge(target, this.plugin);
    this.deepMerge(target, this.overrides);

    this.activeSnapshot = this.deepFreeze(target);
  }

  private deepFreeze(obj: any): any {
    Object.freeze(obj);
    for (const key of Object.getOwnPropertyNames(obj)) {
      const val = obj[key];
      if (val !== null && (typeof val === 'object' || typeof val === 'function') && !Object.isFrozen(val)) {
        this.deepFreeze(val);
      }
    }
    return obj;
  }

  private deepMerge(target: any, source: any) {
    for (const key of Object.keys(source)) {
      if (source[key] instanceof Object && !Array.isArray(source[key])) {
        if (!target[key]) target[key] = {};
        this.deepMerge(target[key], source[key]);
      } else {
        target[key] = source[key];
      }
    }
  }

  public getSnapshot(): any {
    return this.activeSnapshot;
  }

  /**
   * Atomic Transaction Updates: Validate -> Backup -> Apply -> Verify -> Publish -> Commit.
   */
  public async updateConfig(layer: 'platform' | 'environment' | 'workspace' | 'plugin' | 'overrides', key: string, value: any): Promise<boolean> {
    // 1. Validate
    const schema = this.schema.get(key);
    if (schema) {
      const err = this.validateValue(schema, value);
      if (err) {
        await this.publishEvent('ConfigurationRejected', { key, value, reason: err });
        throw new Error(`ValidationResultFailed: ${err}`);
      }
    }

    // 2. Backup
    const backup = JSON.stringify(this[layer]);

    // 3. Apply
    this.setPathValue(this[layer], key, value);
    const oldSnapshot = this.activeSnapshot;
    
    try {
      this.rebuildSnapshot();

      // 4. Verify
      const newValue = this.get(key);
      if (newValue !== value) {
        throw new Error('Verification failed: applied value mismatch');
      }

      // 5. Watch notifications
      this.notifyWatchers(key, value);

      // 6. Publish Event & Commit
      await this.publishEvent('ConfigurationUpdated', { key, value, layer });
      return true;

    } catch (err: any) {
      // Rollback automatically on failure
      this[layer] = JSON.parse(backup);
      this.activeSnapshot = oldSnapshot;
      await this.publishEvent('ConfigurationRejected', { key, value, reason: err.message });
      return false;
    }
  }

  private validateValue(schema: ConfigurationItemSchema, value: any): string | null {
    if (schema.required && (value === undefined || value === null)) {
      return `Required configuration field is missing: ${schema.key}`;
    }
    if (schema.type === 'number') {
      if (typeof value !== 'number' || isNaN(value)) return `${schema.key} must be a number`;
      if (schema.min !== undefined && value < schema.min) return `${schema.key} must be >= ${schema.min}`;
      if (schema.max !== undefined && value > schema.max) return `${schema.key} must be <= ${schema.max}`;
    }
    if (schema.type === 'boolean' && typeof value !== 'boolean') {
      return `${schema.key} must be a boolean`;
    }
    if (schema.type === 'enum' && schema.allowedValues && !schema.allowedValues.includes(value)) {
      return `${schema.key} must be one of: [${schema.allowedValues.join(', ')}]`;
    }
    if (schema.regex && !schema.regex.test(String(value))) {
      return `${schema.key} value does not match regex constraints`;
    }
    return null;
  }

  public get(key: string): any {
    const parts = key.split('.');
    let cur = this.activeSnapshot;
    for (const part of parts) {
      if (cur === undefined || cur === null) return undefined;
      cur = cur[part];
    }
    return cur;
  }

  private setPathValue(obj: any, key: string, value: any) {
    const parts = key.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!cur[part]) cur[part] = {};
      cur = cur[part];
    }
    cur[parts[parts.length - 1]] = value;
  }

  // Watch service callbacks
  public watch(key: string, callback: (newVal: any) => void): { unsubscribe: () => void } {
    if (!this.watchers.has(key)) {
      this.watchers.set(key, []);
    }
    this.watchers.get(key)!.push(callback);
    return {
      unsubscribe: () => {
        const list = this.watchers.get(key) || [];
        this.watchers.set(key, list.filter(cb => cb !== callback));
      }
    };
  }

  private notifyWatchers(key: string, value: any) {
    const list = this.watchers.get(key) || [];
    for (const cb of list) {
      try {
        cb(value);
      } catch (_) {}
    }
  }

  // ----------------------------------------------------
  // Secure Secrets Management (DPAPI AES Encrypted Fallback)
  // ----------------------------------------------------
  public async storeSecret(key: string, secretValue: string): Promise<void> {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    
    let encrypted = cipher.update(secretValue, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const tag = cipher.getAuthTag().toString('hex');

    this.secrets.set(key, {
      encrypted,
      iv: iv.toString('hex'),
      tag
    });

    await this.publishEvent('SecretStored', { key });
  }

  public async retrieveSecret(key: string): Promise<string | null> {
    const record = this.secrets.get(key);
    if (!record) return null;

    try {
      const iv = Buffer.from(record.iv, 'hex');
      const tag = Buffer.from(record.tag, 'hex');
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, iv);
      decipher.setAuthTag(tag);

      let decrypted = decipher.update(record.encrypted, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      return decrypted;
    } catch (_) {
      return null;
    }
  }

  public async rotateSecret(key: string, newSecretValue: string): Promise<void> {
    if (!this.secrets.has(key)) {
      throw new Error(`SecretNotFound: Secret ${key} does not exist to rotate`);
    }
    await this.storeSecret(key, newSecretValue);
    await this.publishEvent('SecretRotated', { key });
  }

  public async deleteSecret(key: string): Promise<boolean> {
    const removed = this.secrets.delete(key);
    if (removed) {
      await this.publishEvent('SecretDeleted', { key });
    }
    return removed;
  }

  // ----------------------------------------------------
  // Feature Flags
  // ----------------------------------------------------
  public getFeatureFlag(flag: string): FeatureFlag | undefined {
    return this.featureFlags.get(flag);
  }

  public async setFeatureFlag(flag: string, enabled: boolean): Promise<void> {
    const record = this.featureFlags.get(flag);
    if (!record) {
      throw new Error(`FlagNotFound: Feature flag ${flag} is not defined`);
    }
    record.enabled = enabled;
    await this.publishEvent('FeatureFlagChanged', { flag, enabled });
  }

  // ----------------------------------------------------
  // Schema Migrations
  // ----------------------------------------------------
  public async migrateConfig(oldConfigJson: string): Promise<any> {
    const oldConfig = JSON.parse(oldConfigJson);
    const migrated = { ...oldConfig };

    // Auto-migrate rule example: map old platform port names
    if (migrated.port && !migrated.platform?.port) {
      if (!migrated.platform) migrated.platform = {};
      migrated.platform.port = migrated.port;
      delete migrated.port;
    }

    await this.publishEvent('ConfigurationMigrated', { from: oldConfig.version || '0.1.0' });
    return migrated;
  }

  private async publishEvent(type: string, payload: any = {}) {
    if (!this.eventBus) return;
    try {
      await this.eventBus.publish({
        schemaVersion: '1.0.0',
        eventId: `evt_cf_${Math.random().toString(36).substring(2, 9)}`,
        eventType: type,
        eventCategory: 'System',
        timestamp: Date.now(),
        severity: type.includes('Reject') ? 'Error' : 'Information',
        tags: ['configuration'],
        payload,
        metadata: { configSnapshot: true },
        correlationId: 'corr_cf_manager',
        parentEventId: 'root'
      });
    } catch (_) {}
  }
}
