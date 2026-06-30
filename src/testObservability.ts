import { ObservabilityPlatform } from './observability';

async function runObservabilityTests() {
  console.log('==================================================');
  console.log('         MCP OBSERVABILITY PLATFORM TESTS         ');
  console.log('==================================================\n');

  const obs = new ObservabilityPlatform();

  let successCount = 0;
  let failCount = 0;

  function assert(title: string, condition: boolean, message?: string) {
    if (condition) {
      console.log(`[PASS] ${title}`);
      successCount++;
    } else {
      console.error(`[FAIL] ${title} ${message ? '- ' + message : ''}`);
      failCount++;
    }
  }

  // ----------------------------------------------------
  // Test 1: Metrics Collection
  // ----------------------------------------------------
  console.log('--- Testing Metrics Registry ---');
  try {
    obs.recordMetric('command_latency', 'timer', 120, ['win32', 'cmd']);
    obs.recordMetric('event_throughput', 'counter', 1, ['event_bus']);

    const list = obs.getMetrics();
    assert('Metric list is populated with events', list.length === 2);
    assert('Counter metric registered successfully', list.some(m => m.name === 'event_throughput' && m.type === 'counter'));
    assert('Timer metric tracks raw latency values', list.some(m => m.name === 'command_latency' && m.value === 120));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Metrics test error:', err);
  }

  // ----------------------------------------------------
  // Test 2: Distributed Tracing & Correlation Chains
  // ----------------------------------------------------
  console.log('\n--- Testing Distributed Tracing ---');
  try {
    const traceId = 'trace-uuid-12345';
    const spanId = 'span-001';
    
    const trace = obs.startTrace(traceId, spanId, undefined, 'WorkflowEngine', 'dispatchTask');
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 50));
    trace.endSpan('Success');

    const traces = obs.getTraces();
    assert('Trace logs generated successfully', traces.length === 1);
    assert('Trace record maps traceId correlation chains', traces[0].traceId === traceId);
    assert('Span tracks execution durations accurately', traces[0].durationMs >= 40);
    assert('Span tracks correct execution outcome status', traces[0].outcome === 'Success');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Tracing test error:', err);
  }

  // ----------------------------------------------------
  // Test 3: Subsystem Health Aggregation
  // ----------------------------------------------------
  console.log('\n--- Testing Health Aggregation ---');
  try {
    const pristine = obs.aggregateHealth({
      event_bus: 'Healthy',
      terminal_manager: 'Healthy'
    });
    assert('Pristine system states aggregate to Healthy status', pristine.status === 'Healthy');

    const degraded = obs.aggregateHealth({
      event_bus: 'Healthy',
      terminal_manager: 'Degraded'
    });
    assert('Single degraded subsystem drops aggregate state to Degraded', degraded.status === 'Degraded');

    const unhealthy = obs.aggregateHealth({
      event_bus: 'Unhealthy',
      terminal_manager: 'Healthy'
    });
    assert('Unhealthy subsystem forces platform state to Unhealthy', unhealthy.status === 'Unhealthy');

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Health aggregation test error:', err);
  }

  // ----------------------------------------------------
  // Test 4: Lightweight Profiler
  // ----------------------------------------------------
  console.log('\n--- Testing Lightweight Profiler ---');
  try {
    const sample = obs.sampleProfiler();
    assert('Profiler returns valid CPU usages', sample.cpuUsage !== undefined);
    assert('Profiler extracts RSS memory consumption metrics', sample.memoryUsageMb.rss > 0);
    assert('Profiler extracts Heap consumption stats', sample.memoryUsageMb.heapTotal > 0);

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Profiler test error:', err);
  }

  // ----------------------------------------------------
  // Test 5: Alert Manager
  // ----------------------------------------------------
  console.log('\n--- Testing Rule-Based Alert Manager ---');
  try {
    // Record command latency exceeding threshold limits (5000 ms)
    obs.recordMetric('command_latency', 'timer', 8500, ['slow_command']);
    
    const alerts = obs.getAlerts();
    assert('Alert successfully triggered on latency limits violation', alerts.length > 0);
    assert('Alert rules matching tag sets high severity indicator', alerts.some(a => a.ruleName === 'HighCommandLatency' && a.severity === 'Critical'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Alert test error:', err);
  }

  // ----------------------------------------------------
  // Test 6: Export Manager Exporters
  // ----------------------------------------------------
  console.log('\n--- Testing Export Formats (JSON & CSV) ---');
  try {
    const json = obs.exportMetrics('json');
    assert('Metrics json export returns valid JSON string', JSON.parse(json).length > 0);

    const csv = obs.exportMetrics('csv');
    assert('Metrics csv export returns correct headers', csv.includes('name,type,value'));
    assert('Metrics csv values formatted as rows', csv.includes('command_latency,timer,120'));

  } catch (err: any) {
    failCount++;
    console.error('[FAIL] Export test error:', err);
  }

  console.log('\n==================================================');
  console.log(`OBSERVABILITY TEST SUMMARY: ${successCount} PASSED, ${failCount} FAILED`);
  console.log('==================================================');

  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runObservabilityTests().catch(console.error);
