export interface PendingAction {
  token: string;
  description: string;
  execute: () => Promise<any>;
  createdAt: number;
}

export class SecurityGates {
  private pendingActions = new Map<string, PendingAction>();

  public createConfirmation(description: string, execute: () => Promise<any>): { token: string; message: string } {
    const token = `confirm_${Math.random().toString(36).substring(2, 9)}`;
    
    this.pendingActions.set(token, {
      token,
      description,
      execute,
      createdAt: Date.now()
    });

    // Automatically clean up old tokens after 5 minutes
    setTimeout(() => {
      this.pendingActions.delete(token);
    }, 5 * 60 * 1000);

    return {
      token,
      message: `CONFIRMATION_REQUIRED: The requested action "${description}" is destructive. Please invoke the "confirm_action" tool with token "${token}" and set "confirmed" to true to proceed.`
    };
  }

  public async confirm(token: string, confirmed: boolean): Promise<{ success: boolean; result?: any; error?: string }> {
    const action = this.pendingActions.get(token);
    if (!action) {
      return { success: false, error: 'Invalid or expired confirmation token' };
    }

    this.pendingActions.delete(token);

    if (!confirmed) {
      return { success: false, error: 'Action cancelled by the user' };
    }

    try {
      const result = await action.execute();
      return { success: true, result };
    } catch (e: any) {
      return { success: false, error: e.message || 'Execution failed during confirmed action' };
    }
  }
}
