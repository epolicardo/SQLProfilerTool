# OpenTelemetry Implementation for SQL Server Profiler Tool

## Overview

This document describes the OpenTelemetry implementation for the SQL Server Profiler Tool VS Code extension. OpenTelemetry provides comprehensive observability through distributed tracing, metrics collection, and structured logging.

## Architecture

### Components

1. **OpenTelemetryService** (`src/utils/OpenTelemetryService.ts`)
   - Singleton service that manages the OpenTelemetry SDK
   - Provides high-level APIs for creating spans, recording metrics, and handling errors
   - Automatically sanitizes sensitive information (passwords, connection strings)

2. **Instrumented Components**
   - **SqlProfilerManager**: Traces profiling sessions, connection operations, and XE session management
   - **ConnectionPoolManager**: Tracks connection pool metrics (active, idle, total connections)
   - **AutoReconnectManager**: Records reconnection attempts and circuit breaker events

### Observability Signals

#### Traces (Distributed Tracing)
Traces provide insights into the flow of operations:

- **extension.activate**: Extension activation lifecycle
- **profiler.startProfiling**: Complete profiling session start
  - **profiler.connectUsingPool**: Connection establishment
  - **profiler.createXESession**: Extended Events session creation
- **profiler.stopProfiling**: Profiling session cleanup

Each span includes attributes like:
- `profiler.sessionName`: Name of the XE session
- `profiler.serverType`: Database type (azure/sqlserver)
- `profiler.pollingInterval`: Polling frequency
- `connection.profile`: Connection profile name

#### Metrics
Metrics provide quantitative measurements:

- **events.captured** (Counter): Total SQL events captured by type
- **query.duration** (Histogram): SQL query execution duration
- **connection.pool.size** (ObservableGauge): Connection pool statistics
  - Active connections
  - Idle connections
  - Total connections
- **errors.total** (Counter): Total errors by type
- **reconnections.total** (Counter): Reconnection attempts by success/failure

#### Error Tracking
Errors are automatically recorded with:
- Error type classification
- Stack traces (sanitized)
- Context attributes
- Associated spans

## Configuration

### VS Code Settings

Add to your `.vscode/settings.json` or user settings (optional):

```json
{
  "sqlProfiler.telemetryEnabled": true,
  "sqlProfiler.openTelemetry": {
    "endpoint": "https://brazilsouth-1.in.applicationinsights.azure.com",
    "headers": {
      // Optional: Add authentication headers for your backend
      // "Authorization": "Bearer YOUR_TOKEN"
    }
  }
}
```

**Default behavior**: Telemetry is sent to **Azure Application Insights** (OTLP). Override the endpoint if you want to use a local collector or another backend.

### OTLP Collector Setup

#### Local Development (Docker)

```bash
# Using OpenTelemetry Collector
docker run -d --name otel-collector \
  -p 4318:4318 \
  -p 4317:4317 \
  otel/opentelemetry-collector:latest

# Using Jaeger (includes OTLP receiver)
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

#### Cloud Platforms

**Azure Monitor / Application Insights:**
```json
{
  "sqlProfiler.openTelemetry": {
    "endpoint": "https://your-region.in.applicationinsights.azure.com/v1/traces",
    "headers": {
      "x-api-key": "YOUR_INSTRUMENTATION_KEY"
    }
  }
}
```

**Datadog:**
```json
{
  "sqlProfiler.openTelemetry": {
    "endpoint": "https://http-intake.logs.datadoghq.com/api/v2/otlp",
    "headers": {
      "DD-API-KEY": "YOUR_DD_API_KEY"
    }
  }
}
```

**Grafana Cloud:**
```json
{
  "sqlProfiler.openTelemetry": {
    "endpoint": "https://otlp-gateway-prod-us-central-0.grafana.net/otlp",
    "headers": {
      "Authorization": "Basic YOUR_BASE64_CREDENTIALS"
    }
  }
}
```

## Usage Examples

### Viewing Traces

With Jaeger running locally:
1. Navigate to http://localhost:16686
2. Select "sql-server-profiler-tool" from the service dropdown
3. Search for traces
4. Explore the waterfall view to see operation timings

### Analyzing Metrics

Example queries (Prometheus QL):

```promql
# Average profiling session duration
avg(query_duration{metric_type="session_duration"})

# Connection pool utilization
connection_pool_size{state="active"} / connection_pool_size{state="total"}

# Reconnection success rate
sum(reconnections_total{success="true"}) / sum(reconnections_total)

# Error rate by type
rate(errors_total[5m])
```

### Custom Instrumentation

To add custom spans in your code:

```typescript
import { OpenTelemetryService } from './utils/OpenTelemetryService';

const otelService = OpenTelemetryService.getInstance();

// Simple span
const span = otelService?.startSpan('my.operation', {
  'custom.attribute': 'value'
});

try {
  // Your operation here
  otelService?.endSpan(span!);
} catch (error) {
  otelService?.recordException(span!, error as Error);
  span?.end();
  throw error;
}

// Active span with callback
otelService?.startActiveSpan('my.operation', { attr: 'value' }, (span) => {
  // Operation is tracked automatically
  // Span ends when callback completes
  return result;
});

// Record metrics
otelService?.recordEventCaptured('custom_event', 5);
otelService?.recordQueryDuration(1234, { query_type: 'select' });
otelService?.recordError('custom_error', { severity: 'high' });
```

## Data Privacy and Security

### Automatic Sanitization

The OpenTelemetry service automatically sanitizes sensitive information:

- Connection strings (Server, User Id, Password, Data Source)
- SQL authentication credentials
- Any strings containing database credentials

Example:
```
Before: "Server=myserver.database.windows.net;User Id=admin;Password=secret123;Database=mydb"
After:  "Server=***;User Id=***;Password=***;Database=mydb"
```

### Telemetry Opt-out

Users can disable telemetry:
1. Set `sqlProfiler.telemetryEnabled` to `false` in settings
2. Disable VS Code telemetry globally (respects `telemetry.telemetryLevel`)

When disabled, all OpenTelemetry operations become no-ops with zero overhead.

## Performance Considerations

### Overhead
- Tracing: ~0.1-0.5ms per span
- Metrics: Negligible (collected periodically, not per-operation)
- Export: Asynchronous, non-blocking

### Resource Usage
- Memory: ~10-20MB for SDK and buffering
- Network: ~1-5KB per trace, metrics exported every 60 seconds
- CPU: <1% additional usage

### Optimization Tips
1. Use sampling for high-traffic scenarios
2. Adjust metric export interval (`exportIntervalMillis`)
3. Disable auto-instrumentation if not needed
4. Use batch exporters for better throughput

## Monitoring Dashboard Example

### Grafana Dashboard

Example dashboard panels:

```json
{
  "panels": [
    {
      "title": "Profiling Sessions",
      "targets": [
        {
          "expr": "rate(events_captured_total[5m])",
          "legendFormat": "{{event_type}}"
        }
      ]
    },
    {
      "title": "Connection Pool Health",
      "targets": [
        {
          "expr": "connection_pool_size{state=\"active\"}",
          "legendFormat": "Active"
        },
        {
          "expr": "connection_pool_size{state=\"idle\"}",
          "legendFormat": "Idle"
        }
      ]
    },
    {
      "title": "Error Rate",
      "targets": [
        {
          "expr": "rate(errors_total[5m])",
          "legendFormat": "{{error_type}}"
        }
      ]
    },
    {
      "title": "Query Duration (P95)",
      "targets": [
        {
          "expr": "histogram_quantile(0.95, query_duration_bucket)",
          "legendFormat": "95th percentile"
        }
      ]
    }
  ]
}
```

## Troubleshooting

### No Data in Backend

1. **Check endpoint configuration**
   ```bash
   # Test endpoint is reachable
   curl -X POST http://localhost:4318/v1/traces
   ```

2. **Verify telemetry is enabled**
   - Check `sqlProfiler.telemetryEnabled` setting
   - Check VS Code global telemetry setting

3. **Check extension logs**
   - Run command: "SQL Profiler: Show Logs"
   - Look for OpenTelemetry initialization messages

### High Memory Usage

1. Reduce metric export frequency:
   ```typescript
   // In OpenTelemetryService.ts
   exportIntervalMillis: 120000  // Export every 2 minutes instead of 1
   ```

2. Disable auto-instrumentation:
   ```typescript
   // Remove from SDK initialization
   instrumentations: []
   ```

### Missing Spans

1. Verify operations are completing successfully
2. Check for span ending (all spans must call `span.end()`)
3. Increase batch processor timeout if using batching

## Future Enhancements

- [ ] Support for W3C Trace Context propagation across extensions
- [ ] Custom samplers for high-volume scenarios
- [ ] Log correlation with traces
- [ ] Performance profiling instrumentation
- [ ] Custom exporters for specific backends
- [ ] Metric aggregation and views
- [ ] Span events for detailed operation logging
- [ ] Resource detection for container environments

## References

- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [OTLP Specification](https://github.com/open-telemetry/opentelemetry-specification/blob/main/specification/protocol/otlp.md)
- [Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
