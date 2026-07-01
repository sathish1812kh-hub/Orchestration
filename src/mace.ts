import { EventBus } from './eventBus';
import { ObservabilityPlatform } from './observability';

export interface MaceSession {
  sessionId: string;
  state: 'Initializing' | 'Executing' | 'Paused' | 'Cancelled' | 'Completed';
  participants: string[];
  roles: Record<string, string>;
  artifacts: string[];
  votes: Record<string, number>;
  reviews: Array<{ reviewer: string; target: string; passed: boolean }>;
}

export class MaceCollaborationEngine {
  private eventBus: EventBus;
  private obs: ObservabilityPlatform;
  private sessions: Record<string, MaceSession> = {};

  constructor(eventBus: EventBus, obs: ObservabilityPlatform) {
    this.eventBus = eventBus;
    this.obs = obs;
  }

  private publishEvent(sessionId: string, eventType: string, payload: any, severity: 'Trace' | 'Debug' | 'Information' | 'Warning' | 'Error' | 'Critical' = 'Information'): void {
    this.eventBus.publish({
      schemaVersion: '1.0.0',
      eventId: Math.random().toString(36).substring(7),
      eventType,
      eventCategory: 'mace',
      timestamp: Date.now(),
      correlationId: sessionId,
      parentEventId: 'none',
      sessionId,
      severity,
      tags: ['mace', eventType],
      payload,
      metadata: { sessionId },
      priority: severity === 'Error' ? 'High' : severity === 'Warning' ? 'Normal' : 'Low'
    });
  }

  public createSession(sessionId: string, participants: string[], roles: Record<string, string>): MaceSession {
    const session: MaceSession = {
      sessionId,
      state: 'Initializing',
      participants,
      roles,
      artifacts: [],
      votes: {},
      reviews: []
    };
    this.sessions[sessionId] = session;
    this.publishEvent(sessionId, 'CollaborationStarted', { sessionId, participants, roles });
    return session;
  }

  public startSession(sessionId: string): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.state = 'Executing';
    this.publishEvent(sessionId, 'TaskDelegated', { sessionId, subtask: 'PlanningPhase' });
  }

  public pauseSession(sessionId: string): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.state = 'Paused';
  }

  public resumeSession(sessionId: string): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.state = 'Executing';
  }

  public cancelSession(sessionId: string): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.state = 'Cancelled';
    this.publishEvent(sessionId, 'CollaborationCancelled', { sessionId }, 'Warning');
  }

  public completeSession(sessionId: string): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.state = 'Completed';
    this.publishEvent(sessionId, 'CollaborationCompleted', { sessionId });
  }

  public addArtifact(sessionId: string, artifactPath: string): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.artifacts.push(artifactPath);
    this.publishEvent(sessionId, 'TaskCompleted', { sessionId, artifactPath });
  }

  public submitReview(sessionId: string, reviewer: string, target: string, passed: boolean): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.reviews.push({ reviewer, target, passed });
    this.publishEvent(sessionId, 'ReviewCompleted', { sessionId, reviewer, passed });

    if (!passed) {
      this.publishEvent(sessionId, 'ConflictDetected', { sessionId, conflictType: 'ReviewFailed', target }, 'Error');
    }
  }

  public submitVote(sessionId: string, voter: string, score: number): void {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);
    session.votes[voter] = score;
    this.publishEvent(sessionId, 'VoteSubmitted', { sessionId, voter, score });
  }

  public evaluateMerge(sessionId: string): { merged: boolean; verdict: string } {
    const session = this.sessions[sessionId];
    if (!session) throw new Error(`Session ${sessionId} not found`);

    this.publishEvent(sessionId, 'MergeStarted', { sessionId });

    const scores = Object.values(session.votes);
    if (scores.length === 0) {
      return { merged: false, verdict: 'No votes submitted' };
    }

    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const merged = avg >= 70;
    const verdict = merged ? 'Approved' : 'Rejected';

    this.publishEvent(sessionId, 'MergeCompleted', { sessionId, merged, verdict });

    return { merged, verdict };
  }

  public getSession(sessionId: string): MaceSession | undefined {
    return this.sessions[sessionId];
  }

  public getSessionsList(): MaceSession[] {
    return Object.values(this.sessions);
  }
}
