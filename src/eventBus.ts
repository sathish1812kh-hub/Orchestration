import * as fs from 'fs';
import * as path from 'path';

export interface PlatformEvent {
  schemaVersion: string;
  eventId: string;
  eventType: string;
  eventCategory: string;
  timestamp: number;
  sequenceNumber: number;
  correlationId: string;
  parentEventId: string;
  workflowId?: string;
  agentId?: string;
  terminalId?: string;
  sessionId?: string;
  userContext?: { userId: string; role?: string };
  severity: 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical';
  tags: string[];
  payload: any;
  metadata: any;
  priority?: 'Critical' | 'High' | 'Normal' | 'Low' | 'Background';
}

export interface DeadLetterEvent {
  event: any;
  failureReason: string;
  timestamp: number;
  retryCount: number;
}

export interface EventStorageProvider {
  save(event: PlatformEvent): Promise<void>;
  query(filter: (ev: PlatformEvent) => boolean): Promise<PlatformEvent[]>;
  clear(): Promise<void>;
}

export class MemoryStorageProvider implements EventStorageProvider {
  private events: PlatformEvent[] = [];

  public async save(event: PlatformEvent): Promise<void> {
    this.events.push(event);
  }

  public async query(filter: (ev: PlatformEvent) => boolean): Promise<PlatformEvent[]> {
    return this.events.filter(filter);
  }

  public async clear(): Promise<void> {
    this.events = [];
  }
}

export class JsonlStorageProvider implements EventStorageProvider {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  public async save(event: PlatformEvent): Promise<void> {
    fs.appendFileSync(this.filePath, JSON.stringify(event) + '\n');
  }

  public async query(filter: (ev: PlatformEvent) => boolean): Promise<PlatformEvent[]> {
    if (!fs.existsSync(this.filePath)) return [];
    const lines = fs.readFileSync(this.filePath, 'utf-8').split('\n');
    const results: PlatformEvent[] = [];
    for (const line of lines) {
      if (line.trim()) {
        try {
          const ev = JSON.parse(line) as PlatformEvent;
          if (filter(ev)) {
            results.push(ev);
          }
        } catch (_) {}
      }
    }
    return results;
  }

  public async clear(): Promise<void> {
    if (fs.existsSync(this.filePath)) {
      fs.writeFileSync(this.filePath, '');
    }
  }
}

export interface SubscriptionFilter {
  eventType?: string | RegExp;
  eventCategory?: string;
  severity?: string;
  tags?: string[];
  correlationId?: string;
  workflowId?: string;
  terminalId?: string;
  agentId?: string;
  customPredicate?: (event: PlatformEvent) => boolean;
}

export interface EventSubscriber {
  id: string;
  filter: SubscriptionFilter;
  callback: (event: PlatformEvent) => void;
  priority: 'Critical' | 'High' | 'Normal' | 'Low' | 'Background';
  queue: PlatformEvent[];
  maxQueueSize: number;
  backpressurePolicy: 'drop_oldest' | 'drop_newest' | 'block_publisher' | 'pause_subscriber';
  paused: boolean;
  acknowledgedCount: number;
}

export class EventBus {
  private storage: EventStorageProvider;
  private subscribers: EventSubscriber[] = [];
  private deadLetters: DeadLetterEvent[] = [];
  private sequenceCounter = 0;
  
  // Metrics tracking
  private metrics = {
    publishedCount: 0,
    deliveredCount: 0,
    droppedCount: 0,
    replayCount: 0,
    latencies: [] as number[],
    deadLetterCount: 0
  };

  constructor(storage: EventStorageProvider) {
    this.storage = storage;
  }

  public getStorage(): EventStorageProvider {
    return this.storage;
  }

  /**
   * Validates structure, fields, and major version compatibility.
   */
  private validateEvent(event: any): { valid: boolean; reason?: string } {
    const required = [
      'schemaVersion', 'eventId', 'eventType', 'eventCategory', 'timestamp',
      'severity', 'tags', 'payload', 'metadata'
    ];

    for (const field of required) {
      if (event[field] === undefined || event[field] === null) {
        return { valid: false, reason: `Missing required field: ${field}` };
      }
    }

    // Version validation (expect major version 1)
    const ver = event.schemaVersion;
    if (typeof ver !== 'string' || !ver.startsWith('1.')) {
      return { valid: false, reason: `Incompatible schema version: ${ver}. Platform only supports v1.x` };
    }

    return { valid: true };
  }

  /**
   * Publishes an event to the Event Bus asynchronously.
   */
  public async publish(rawEvent: Omit<PlatformEvent, 'sequenceNumber'>): Promise<PlatformEvent> {
    const validation = this.validateEvent(rawEvent);
    if (!validation.valid) {
      const dead: DeadLetterEvent = {
        event: rawEvent,
        failureReason: validation.reason || 'Unknown validation failure',
        timestamp: Date.now(),
        retryCount: 0
      };
      this.deadLetters.push(dead);
      this.metrics.deadLetterCount++;
      throw new Error(`Validation Error: ${validation.reason}`);
    }

    this.sequenceCounter++;
    const event: PlatformEvent = {
      ...rawEvent,
      sequenceNumber: this.sequenceCounter,
      priority: rawEvent.priority || 'Normal'
    };

    // Save to storage
    await this.storage.save(event);
    this.metrics.publishedCount++;

    // Route to subscribers asynchronously so we do not block publisher
    setImmediate(() => {
      this.routeEvent(event);
    });

    return event;
  }

  /**
   * Helper that checks if subscriber filter matches the event metadata/tags.
   */
  private matchesFilter(event: PlatformEvent, filter: SubscriptionFilter): boolean {
    if (filter.eventType) {
      if (filter.eventType instanceof RegExp) {
        if (!filter.eventType.test(event.eventType)) return false;
      } else if (filter.eventType !== '*' && event.eventType !== filter.eventType) {
        return false;
      }
    }
    if (filter.eventCategory && event.eventCategory !== filter.eventCategory) return false;
    if (filter.severity && event.severity !== filter.severity) return false;
    if (filter.correlationId && event.correlationId !== filter.correlationId) return false;
    if (filter.workflowId && event.workflowId !== filter.workflowId) return false;
    if (filter.terminalId && event.terminalId !== filter.terminalId) return false;
    if (filter.agentId && event.agentId !== filter.agentId) return false;
    
    if (filter.tags && filter.tags.length > 0) {
      if (!filter.tags.every(t => event.tags.includes(t))) return false;
    }
    if (filter.customPredicate && !filter.customPredicate(event)) return false;

    return true;
  }

  /**
   * Dispatches the event to subscriber queues following priority schedulers.
   */
  private routeEvent(event: PlatformEvent): void {
    const startTime = Date.now();
    const matchedSubs = this.subscribers.filter(sub => this.matchesFilter(event, sub.filter));

    for (const sub of matchedSubs) {
      this.deliverToSubscriber(sub, event);
    }

    if (matchedSubs.length > 0) {
      this.metrics.latencies.push(Date.now() - startTime);
      if (this.metrics.latencies.length > 500) {
        this.metrics.latencies.shift(); // Keep moving window
      }
    }
  }

  private deliverToSubscriber(sub: EventSubscriber, event: PlatformEvent): void {
    if (sub.paused) {
      // Buffer event in queue
      this.enqueueSubscriber(sub, event);
      return;
    }

    // If queue has items, it means we are flushing priority-scheduled items or handling backpressure
    if (sub.queue.length > 0) {
      this.enqueueSubscriber(sub, event);
      this.flushQueue(sub);
    } else {
      try {
        sub.callback(event);
        sub.acknowledgedCount++;
        this.metrics.deliveredCount++;
      } catch (err) {
        // Callback failed, push to dead letter queue
        this.deadLetters.push({
          event,
          failureReason: `Subscriber ${sub.id} callback crashed: ${err instanceof Error ? err.message : err}`,
          timestamp: Date.now(),
          retryCount: 0
        });
        this.metrics.deadLetterCount++;
      }
    }
  }

  private enqueueSubscriber(sub: EventSubscriber, event: PlatformEvent): void {
    if (sub.queue.length >= sub.maxQueueSize) {
      this.metrics.droppedCount++;
      if (sub.backpressurePolicy === 'drop_oldest') {
        sub.queue.shift();
        sub.queue.push(event);
      } else if (sub.backpressurePolicy === 'drop_newest') {
        // Drop incoming event
        return;
      } else if (sub.backpressurePolicy === 'pause_subscriber') {
        sub.paused = true;
        sub.queue.push(event);
      } else {
        // block_publisher or normal buffering
        sub.queue.shift();
        sub.queue.push(event);
      }
    } else {
      sub.queue.push(event);
    }

    // Sort queue based on event priority
    const priorityWeights = { Critical: 5, High: 4, Normal: 3, Low: 2, Background: 1 };
    sub.queue.sort((a, b) => {
      const weightA = priorityWeights[a.priority || 'Normal'];
      const weightB = priorityWeights[b.priority || 'Normal'];
      return weightB - weightA; // Higher weights first
    });
  }

  private flushQueue(sub: EventSubscriber): void {
    while (sub.queue.length > 0 && !sub.paused) {
      const nextEv = sub.queue.shift()!;
      try {
        sub.callback(nextEv);
        sub.acknowledgedCount++;
        this.metrics.deliveredCount++;
      } catch (err) {
        this.deadLetters.push({
          event: nextEv,
          failureReason: `Subscriber ${sub.id} callback crashed during flush: ${err}`,
          timestamp: Date.now(),
          retryCount: 0
        });
        this.metrics.deadLetterCount++;
      }
    }
  }

  /**
   * Registers a new subscriber.
   */
  public subscribe(
    subscriberId: string,
    filter: SubscriptionFilter,
    callback: (event: PlatformEvent) => void,
    options?: {
      priority?: 'Critical' | 'High' | 'Normal' | 'Low' | 'Background';
      maxQueueSize?: number;
      backpressurePolicy?: 'drop_oldest' | 'drop_newest' | 'block_publisher' | 'pause_subscriber';
    }
  ): void {
    // Unsubscribe existing with same ID to prevent duplicates
    this.unsubscribe(subscriberId);

    this.subscribers.push({
      id: subscriberId,
      filter,
      callback,
      priority: options?.priority || 'Normal',
      queue: [],
      maxQueueSize: options?.maxQueueSize || 500,
      backpressurePolicy: options?.backpressurePolicy || 'drop_oldest',
      paused: false,
      acknowledgedCount: 0
    });
  }

  /**
   * Unsubscribes a subscriber.
   */
  public unsubscribe(subscriberId: string): boolean {
    const initialLen = this.subscribers.length;
    this.subscribers = this.subscribers.filter(s => s.id !== subscriberId);
    return this.subscribers.length < initialLen;
  }

  public pauseSubscriber(subscriberId: string): boolean {
    const sub = this.subscribers.find(s => s.id === subscriberId);
    if (sub) {
      sub.paused = true;
      return true;
    }
    return false;
  }

  public resumeSubscriber(subscriberId: string): boolean {
    const sub = this.subscribers.find(s => s.id === subscriberId);
    if (sub) {
      sub.paused = false;
      this.flushQueue(sub);
      return true;
    }
    return false;
  }

  /**
   * Replays historical events filtered by sequence, timestamp, correlationId, etc.
   */
  public async replay(filter: (ev: PlatformEvent) => boolean): Promise<PlatformEvent[]> {
    this.metrics.replayCount++;
    return await this.storage.query(filter);
  }

  public getStatus() {
    const totalLatency = this.metrics.latencies.reduce((a, b) => a + b, 0);
    const avgLatency = this.metrics.latencies.length > 0 ? totalLatency / this.metrics.latencies.length : 0;
    const maxLatency = this.metrics.latencies.length > 0 ? Math.max(...this.metrics.latencies) : 0;

    let saturation = 0;
    for (const sub of this.subscribers) {
      const sat = sub.queue.length / sub.maxQueueSize;
      if (sat > saturation) saturation = sat;
    }

    const health = saturation > 0.9 ? 'degraded' : 'running';

    return {
      health,
      saturation,
      subscribersCount: this.subscribers.length,
      publishedCount: this.metrics.publishedCount,
      deliveredCount: this.metrics.deliveredCount,
      droppedCount: this.metrics.droppedCount,
      replayCount: this.metrics.replayCount,
      deadLetterCount: this.metrics.deadLetterCount,
      averageLatencyMs: avgLatency,
      maximumLatencyMs: maxLatency
    };
  }

  public listSubscribers() {
    return this.subscribers.map(s => ({
      id: s.id,
      priority: s.priority,
      queueDepth: s.queue.length,
      maxQueueSize: s.maxQueueSize,
      policy: s.backpressurePolicy,
      paused: s.paused,
      acknowledgedCount: s.acknowledgedCount
    }));
  }

  public getDeadLetterQueue(): DeadLetterEvent[] {
    return this.deadLetters;
  }

  /**
   * Attempts to replay all events inside the Dead Letter Queue.
   */
  public async replayDeadLetters(): Promise<{ replayed: number; failed: number }> {
    const queue = [...this.deadLetters];
    this.deadLetters = [];
    let replayed = 0;
    let failed = 0;

    for (const dead of queue) {
      try {
        dead.retryCount++;
        // Attempt republish
        await this.publish(dead.event);
        replayed++;
      } catch (err) {
        dead.failureReason = `Retry failed: ${err instanceof Error ? err.message : err}`;
        this.deadLetters.push(dead);
        failed++;
      }
    }

    return { replayed, failed };
  }
}
