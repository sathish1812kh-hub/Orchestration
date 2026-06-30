import { PromptDetectionEngine, PromptDetectionResult } from './promptDetector';
import { TerminalManager, InteractiveTerminal } from './terminalManager';
import { ShellType } from './types';

export interface TerminalEvent {
  eventId: string;
  schemaVersion: string;
  terminalId: string;
  sessionId: string;
  sequence: number;
  timestamp: number;
  eventType: string;
  stream: 'stdout' | 'stderr' | 'system';
  payload: any;
  metadata: {
    cursorX: number;
    cursorY: number;
    promptState: string;
    busyState: string;
  };
}

export type OverflowPolicy = 'drop_oldest' | 'drop_newest' | 'block';

export interface Subscriber {
  id: string;
  filter?: {
    eventTypes?: string[];
    minSequence?: number;
    streamTypes?: ('stdout' | 'stderr' | 'system')[];
  };
  queue: TerminalEvent[];
  maxQueueSize: number;
  overflowPolicy: OverflowPolicy;
  callback: (event: TerminalEvent) => void;
}

export class StreamingEngine {
  private terminalManager: TerminalManager;
  private promptDetector: PromptDetectionEngine;
  
  // Replay buffers: terminalUuid -> list of historical events
  private replayBuffers = new Map<string, TerminalEvent[]>();
  private maxReplaySize = 1000;

  // Sequence generators: terminalUuid -> next sequence number
  private sequences = new Map<string, number>();

  // Subscribers: terminalUuid -> List of subscribers
  private subscribers = new Map<string, Subscriber[]>();

  // Active polling loops: terminalUuid -> Timer handle
  private pollIntervals = new Map<string, NodeJS.Timeout>();
  private defaultInterval = 100;

  // Cache of last captures for diffing
  private lastCaptures = new Map<string, {
    visible: string;
    lines: string[];
    cursorX: number;
    cursorY: number;
    cols: number;
    rows: number;
    state: string;
    profile?: string;
  }>();

  constructor(terminalManager: TerminalManager, promptDetector: PromptDetectionEngine) {
    this.terminalManager = terminalManager;
    this.promptDetector = promptDetector;
  }

  /**
   * Subscribes to a terminal stream.
   */
  public subscribe(
    terminalUuid: string,
    subscriberId: string,
    callback: (event: TerminalEvent) => void,
    options?: {
      eventTypes?: string[];
      minSequence?: number;
      streamTypes?: ('stdout' | 'stderr' | 'system')[];
      maxQueueSize?: number;
      overflowPolicy?: OverflowPolicy;
    }
  ): void {
    const term = this.terminalManager.getTerminal(terminalUuid);
    if (!term) {
      throw new Error(`Terminal session ${terminalUuid} not found.`);
    }

    const subs = this.subscribers.get(terminalUuid) || [];
    const subscriber: Subscriber = {
      id: subscriberId,
      filter: options ? {
        eventTypes: options.eventTypes,
        minSequence: options.minSequence,
        streamTypes: options.streamTypes
      } : undefined,
      queue: [],
      maxQueueSize: options?.maxQueueSize || 500,
      overflowPolicy: options?.overflowPolicy || 'drop_oldest',
      callback
    };

    subs.push(subscriber);
    this.subscribers.set(terminalUuid, subs);

    // If there is replay requested from a sequence number
    if (options?.minSequence !== undefined) {
      this.replayFromSequence(terminalUuid, subscriber, options.minSequence);
    }

    // Ensure polling is active
    this.startPolling(terminalUuid);
  }

  /**
   * Unsubscribes a subscriber.
   */
  public unsubscribe(terminalUuid: string, subscriberId: string): boolean {
    const subs = this.subscribers.get(terminalUuid);
    if (!subs) return false;

    const initialLength = subs.length;
    const filtered = subs.filter(s => s.id !== subscriberId);
    this.subscribers.set(terminalUuid, filtered);

    if (filtered.length === 0) {
      this.stopPolling(terminalUuid);
    }

    return filtered.length < initialLength;
  }

  /**
   * Pauses streaming for a subscriber (stops emitting callbacks, but buffers).
   */
  public pauseSubscriber(terminalUuid: string, subscriberId: string): boolean {
    const subs = this.subscribers.get(terminalUuid);
    const sub = subs?.find(s => s.id === subscriberId);
    if (sub) {
      // By wrapping the callback we can temporarily mute it
      const originalCallback = sub.callback;
      sub.callback = () => {}; // Mute
      (sub as any)._originalCallback = originalCallback;
      return true;
    }
    return false;
  }

  /**
   * Resumes streaming for a subscriber and flushes queue.
   */
  public resumeSubscriber(terminalUuid: string, subscriberId: string): boolean {
    const subs = this.subscribers.get(terminalUuid);
    const sub = subs?.find(s => s.id === subscriberId);
    if (sub && (sub as any)._originalCallback) {
      sub.callback = (sub as any)._originalCallback;
      delete (sub as any)._originalCallback;
      
      // Flush queue
      const q = [...sub.queue];
      sub.queue = [];
      for (const ev of q) {
        sub.callback(ev);
      }
      return true;
    }
    return false;
  }

  /**
   * Replays events from a given sequence number.
   */
  public replay(terminalUuid: string, minSequence: number): TerminalEvent[] {
    const buffer = this.replayBuffers.get(terminalUuid) || [];
    return buffer.filter(e => e.sequence >= minSequence);
  }

  /**
   * Replays history to a subscriber queue directly.
   */
  private replayFromSequence(terminalUuid: string, subscriber: Subscriber, minSequence: number) {
    const buffer = this.replayBuffers.get(terminalUuid) || [];
    const matching = buffer.filter(e => e.sequence >= minSequence);
    
    for (const ev of matching) {
      this.enqueueEvent(subscriber, ev);
    }
  }

  /**
   * Starts the polling timer for a terminal.
   */
  private startPolling(terminalUuid: string): void {
    if (this.pollIntervals.has(terminalUuid)) return;

    // Initialize base capture cache
    this.promptDetector.detectPrompt(terminalUuid, 50).then(res => {
      const lines = res.cleanBuffer.split('\n');
      this.lastCaptures.set(terminalUuid, {
        visible: res.cleanBuffer,
        lines,
        cursorX: res.cursorX,
        cursorY: res.cursorY,
        cols: res.cols,
        rows: res.rows,
        state: res.state,
        profile: res.matchedProfile
      });
    }).catch(() => {});

    const interval = setInterval(async () => {
      try {
        await this.pollTerminalState(terminalUuid);
      } catch (err) {
        // Stop if terminal is deleted/closed
        this.stopPolling(terminalUuid);
      }
    }, this.defaultInterval);

    this.pollIntervals.set(terminalUuid, interval);
  }

  /**
   * Stops the polling timer.
   */
  private stopPolling(terminalUuid: string): void {
    const interval = this.pollIntervals.get(terminalUuid);
    if (interval) {
      clearInterval(interval);
      this.pollIntervals.delete(terminalUuid);
    }
  }

  /**
   * Enforces overflow policy on subscriber queue.
   */
  private enqueueEvent(subscriber: Subscriber, event: TerminalEvent): void {
    // Check if event type or stream is filtered out
    if (subscriber.filter) {
      if (subscriber.filter.eventTypes && !subscriber.filter.eventTypes.includes(event.eventType)) {
        return;
      }
      if (subscriber.filter.streamTypes && !subscriber.filter.streamTypes.includes(event.stream)) {
        return;
      }
    }

    if (subscriber.queue.length >= subscriber.maxQueueSize) {
      if (subscriber.overflowPolicy === 'drop_oldest') {
        subscriber.queue.shift();
        subscriber.queue.push(event);
      } else if (subscriber.overflowPolicy === 'drop_newest') {
        // Drop current event
        return;
      } else {
        // Block: we drop oldest anyway for safety, but can log it
        subscriber.queue.shift();
        subscriber.queue.push(event);
      }
    } else {
      subscriber.queue.push(event);
    }

    // Emit if not muted
    subscriber.callback(event);
  }

  /**
   * Emits a structured event to all subscribers and replay buffer.
   */
  public emitEvent(
    terminalUuid: string,
    eventType: string,
    stream: 'stdout' | 'stderr' | 'system',
    payload: any,
    metadata: { cursorX: number; cursorY: number; promptState: string; busyState: string }
  ): TerminalEvent {
    const nextSeq = (this.sequences.get(terminalUuid) || 0) + 1;
    this.sequences.set(terminalUuid, nextSeq);

    const event: TerminalEvent = {
      eventId: `evt_${Math.random().toString(36).substring(2, 9)}`,
      schemaVersion: '1.0.0',
      terminalId: terminalUuid,
      sessionId: `sess_${terminalUuid}`,
      sequence: nextSeq,
      timestamp: Date.now(),
      eventType,
      stream,
      payload,
      metadata
    };

    // Append to replay buffer
    const buffer = this.replayBuffers.get(terminalUuid) || [];
    buffer.push(event);
    if (buffer.length > this.maxReplaySize) {
      buffer.shift();
    }
    this.replayBuffers.set(terminalUuid, buffer);

    // Distribute to subscribers
    const subs = this.subscribers.get(terminalUuid) || [];
    for (const sub of subs) {
      this.enqueueEvent(sub, event);
    }

    return event;
  }

  /**
   * Main diffing loop that checks for stdout additions, cursor movements, and state transitions.
   */
  private async pollTerminalState(terminalUuid: string): Promise<void> {
    const term = this.terminalManager.getTerminal(terminalUuid);
    if (!term) {
      this.emitEvent(terminalUuid, 'TerminalClosed', 'system', {}, { cursorX: 0, cursorY: 0, promptState: 'Closed', busyState: 'Closed' });
      throw new Error('Closed');
    }

    const res = await this.promptDetector.detectPrompt(terminalUuid, 30);
    const last = this.lastCaptures.get(terminalUuid);

    const meta = {
      cursorX: res.cursorX,
      cursorY: res.cursorY,
      promptState: res.matchedProfile || 'none',
      busyState: res.state
    };

    if (!last) {
      // First capture, set initial cache
      this.lastCaptures.set(terminalUuid, {
        visible: res.cleanBuffer,
        lines: res.cleanBuffer.split('\n'),
        cursorX: res.cursorX,
        cursorY: res.cursorY,
        cols: res.cols,
        rows: res.rows,
        state: res.state,
        profile: res.matchedProfile
      });
      return;
    }

    // 1. Check Window Resize
    if (res.cols !== last.cols || res.rows !== last.rows) {
      this.emitEvent(terminalUuid, 'WindowResized', 'system', { cols: res.cols, rows: res.rows }, meta);
    }

    // 2. Check Cursor Moved
    if (res.cursorX !== last.cursorX || res.cursorY !== last.cursorY) {
      this.emitEvent(terminalUuid, 'CursorMoved', 'system', { x: res.cursorX, y: res.cursorY }, meta);
    }

    // 3. Check State Transitions
    if (res.state !== last.state) {
      if (res.state === 'Prompt Ready') {
        this.emitEvent(terminalUuid, 'TerminalIdle', 'system', {}, meta);
        this.emitEvent(terminalUuid, 'PromptDetected', 'system', { profile: res.matchedProfile }, meta);
      } else if (last.state === 'Prompt Ready') {
        this.emitEvent(terminalUuid, 'TerminalBusy', 'system', {}, meta);
        this.emitEvent(terminalUuid, 'PromptLost', 'system', {}, meta);
      }
    }

    // 4. Calculate Output Diff
    const currentLines = res.cleanBuffer.split('\n');
    let addedText = '';

    if (currentLines.length >= last.lines.length) {
      // Compare common lines
      for (let i = 0; i < last.lines.length; i++) {
        const curLine = currentLines[i] || '';
        const prevLine = last.lines[i] || '';
        if (curLine.startsWith(prevLine) && curLine.length > prevLine.length) {
          addedText += curLine.substring(prevLine.length) + '\n';
        } else if (curLine !== prevLine) {
          // Line completely rewritten (like progress bars or backspaces)
          addedText += curLine + '\n';
        }
      }
      // Add all new lines
      for (let i = last.lines.length; i < currentLines.length; i++) {
        addedText += (currentLines[i] || '') + '\n';
      }
    } else {
      // Screen was cleared or scrolled significantly
      addedText = res.cleanBuffer;
    }

    addedText = addedText.trimEnd();

    if (addedText.length > 0) {
      // Check if it is an error chunk based on active profile rules
      let isError = false;
      if (res.matchedProfile) {
        const prof = this.promptDetector.getRegistry().getProfile(res.matchedProfile);
        if (prof) {
          for (const errInd of prof.errorIndicators) {
            if (addedText.includes(errInd)) {
              isError = true;
            }
          }
        }
      }

      this.emitEvent(
        terminalUuid,
        isError ? 'ErrorChunk' : 'OutputChunk',
        isError ? 'stderr' : 'stdout',
        { chunk: addedText },
        meta
      );
    }

    // Update Cache
    this.lastCaptures.set(terminalUuid, {
      visible: res.cleanBuffer,
      lines: currentLines,
      cursorX: res.cursorX,
      cursorY: res.cursorY,
      cols: res.cols,
      rows: res.rows,
      state: res.state,
      profile: res.matchedProfile
    });
  }

  public getStatus(terminalUuid: string) {
    const subs = this.subscribers.get(terminalUuid) || [];
    const seq = this.sequences.get(terminalUuid) || 0;
    const interval = this.pollIntervals.has(terminalUuid);

    return {
      terminalUuid,
      active: interval,
      sequence: seq,
      subscriberCount: subs.length,
      subscribers: subs.map(s => ({ id: s.id, queueSize: s.queue.length }))
    };
  }

  public stopStream(terminalUuid: string): void {
    this.stopPolling(terminalUuid);
    this.subscribers.delete(terminalUuid);
  }
}
