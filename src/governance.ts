export interface ADR {
  number: number;
  title: string;
  author: string;
  date: string;
  status: 'Proposed' | 'Accepted' | 'Superseded' | 'Deprecated' | 'Rejected';
  context: string;
  decision: string;
  consequences: string;
}

export interface ApiStabilityRecord {
  apiName: string;
  stability: 'Experimental' | 'Beta' | 'Stable' | 'Deprecated' | 'Removed';
  version: string;
}

export class ArchitectureGovernance {
  private adrs: ADR[] = [];
  private apiCatalog: ApiStabilityRecord[] = [
    { apiName: 'Kernel_Core', stability: 'Stable', version: '1.0.0' },
    { apiName: 'EventBus_Core', stability: 'Stable', version: '1.0.0' },
    { apiName: 'IPCR_Process', stability: 'Stable', version: '1.0.0' },
    { apiName: 'GCAC_Profile', stability: 'Stable', version: '1.0.0' }
  ];

  private componentsStatus: Record<string, 'Frozen' | 'Extensible'> = {
    Kernel: 'Frozen',
    EventBus: 'Frozen',
    WorkflowEngine: 'Frozen',
    GCAC: 'Frozen',
    IPCR: 'Frozen',
    PDK: 'Frozen',
    CCL: 'Frozen',
    RCAT: 'Frozen',
    ConnectorProfiles: 'Extensible',
    Plugins: 'Extensible'
  };

  public registerAdr(adr: ADR): void {
    if (this.adrs.some(a => a.number === adr.number)) {
      throw new Error(`ADR #${adr.number} is already registered`);
    }
    this.adrs.push(adr);
  }

  public getAdrs(): ADR[] {
    return this.adrs;
  }

  public updateAdrStatus(number: number, status: ADR['status']): void {
    const adr = this.adrs.find(a => a.number === number);
    if (!adr) throw new Error(`ADR #${number} not found`);
    adr.status = status;
  }

  public getComponentStatus(component: string): 'Frozen' | 'Extensible' {
    return this.componentsStatus[component] || 'Frozen';
  }

  public setComponentStatus(component: string, status: 'Frozen' | 'Extensible'): void {
    this.componentsStatus[component] = status;
  }

  public getApiCatalog(): ApiStabilityRecord[] {
    return this.apiCatalog;
  }

  public registerApi(record: ApiStabilityRecord): void {
    const existing = this.apiCatalog.find(a => a.apiName === record.apiName);
    if (existing) {
      existing.stability = record.stability;
      existing.version = record.version;
    } else {
      this.apiCatalog.push(record);
    }
  }

  public validateExtensionChange(
    componentName: string,
    proposedChangeType: 'refactor' | 'bugfix' | 'feature' | 'breaking'
  ): {
    approved: boolean;
    reason: string;
  } {
    const freezeState = this.getComponentStatus(componentName);
    if (freezeState === 'Frozen') {
      if (proposedChangeType === 'breaking') {
        return {
          approved: false,
          reason: `Component ${componentName} is Frozen. Breaking changes are prohibited without architecture review boards approvals`
        };
      }
      if (proposedChangeType === 'feature') {
        return {
          approved: false,
          reason: `Component ${componentName} is Frozen. Feature extensions must be implemented as plugins or profiles configurations`
        };
      }
    }
    return {
      approved: true,
      reason: 'Change meets components freeze criteria requirements'
    };
  }

  public checkReleaseReadiness(
    testsPassed: boolean,
    observabilityHealthy: boolean,
    documentationComplete: boolean
  ): {
    ready: boolean;
    score: number;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let score = 100;

    if (!testsPassed) {
      score -= 50;
      warnings.push('Failing test suites detected');
    }
    if (!observabilityHealthy) {
      score -= 25;
      warnings.push('Telemetry spans mapping is incomplete');
    }
    if (!documentationComplete) {
      score -= 25;
      warnings.push('Overview architecture guide is missing');
    }

    return {
      ready: score === 100,
      score,
      warnings
    };
  }
}
