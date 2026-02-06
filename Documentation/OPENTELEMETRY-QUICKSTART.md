# Quick Start: OpenTelemetry for SQL Server Profiler Tool

## 🚀 Getting Started in 5 Minutes

### Step 1: Telemetry Configuration (Optional)

✅ **Telemetry is ENABLED by default** to help improve the extension.

🔒 **Your privacy is protected**: All sensitive data (passwords, connection strings, queries) is automatically sanitized.

**To disable telemetry** (optional), add to your VS Code settings:
```json
{
  "sqlProfiler.telemetryEnabled": false
}
```

**To configure a custom OTLP endpoint** (optional), add:
```json
{
  "sqlProfiler.openTelemetry": {
    "endpoint": "http://localhost:4318",  // Your custom endpoint
    "headers": {
      "Authorization": "Bearer YOUR_TOKEN"  // If needed
    }
  }
}
```

💡 **Default behavior**: Telemetry data is sent to **Azure Application Insights** (OTLP). You can override the endpoint to send to a local collector or another backend.

### Step 2: Start a Local Observability Backend

**Option A: Jaeger (Recommended for Beginners)**
```bash
docker run -d --name jaeger \
  -p 16686:16686 \
  -p 4318:4318 \
  jaegertracing/all-in-one:latest
```

View UI at: http://localhost:16686

If you use Jaeger locally, set the endpoint to `http://localhost:4318` in your settings.

**Option B: OpenTelemetry Collector + Prometheus + Grafana**
```bash
# Clone example docker-compose
git clone https://github.com/open-telemetry/opentelemetry-collector-contrib.git
cd opentelemetry-collector-contrib/examples/demo
docker-compose up -d
```

View Grafana at: http://localhost:3000 (admin/admin)

### Step 3: Use the Extension

1. Start profiling: `Ctrl+Shift+P` → "Start SQL Server Profiling"
2. Run some queries against your database
3. Stop profiling: `Ctrl+Shift+P` → "Stop SQL Server Profiling"

### Step 4: View Telemetry Data

**In Jaeger:**
- Navigate to http://localhost:16686
- Service: `sql-server-profiler-tool`
- Click "Find Traces"
- Explore the waterfall view!

**In Grafana:**
- Navigate to http://localhost:3000
- Create a new dashboard
- Add panels with metrics like `connection_pool_size`, `events_captured`, etc.

## 📊 What You'll See

### Traces
- Extension activation
- Profiling session lifecycle
- Connection pool operations
- Extended Events session creation/deletion

### Metrics
- **Events Captured**: How many SQL events were captured
- **Query Duration**: Time distribution of SQL queries
- **Connection Pool**: Active, idle, and total connections
- **Errors**: Categorized by type
- **Reconnections**: Success/failure tracking

### Example Trace View

```
extension.activate (50ms)
└── profiler.startProfiling (2.3s)
    ├── profiler.connectUsingPool (500ms)
    ├── profiler.createXESession (800ms)
    └── profiler.collectResults (1s)
```

## 🔧 Common Configurations

### Azure Application Insights

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

### Datadog

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

### New Relic

```json
{
  "sqlProfiler.openTelemetry": {
    "endpoint": "https://otlp.nr-data.net:4318",
    "headers": {
      "api-key": "YOUR_LICENSE_KEY"
    }
  }
}
```

## 🔍 Useful Queries

### Prometheus Queries

```promql
# Average session duration
avg(query_duration{metric_type="session_duration"})

# Connection pool utilization
connection_pool_size{state="active"} / connection_pool_size{state="total"} * 100

# Events captured per minute
rate(events_captured_total[1m]) * 60

# Error rate
rate(errors_total[5m])
```

## 🛠️ Troubleshooting

**No data showing?**

1. Check if backend is running: `docker ps`
2. Check extension logs: Command Palette → "SQL Profiler: Show Logs"
3. Verify endpoint: `curl http://localhost:4318/v1/traces`

**High memory usage?**

Adjust export frequency in settings:
```json
{
  "sqlProfiler.openTelemetry": {
    "endpoint": "http://localhost:4318",
    "exportIntervalMillis": 120000
  }
}
```

## 🔒 Privacy & Data Collection FAQ

**Q: What data is collected?**
- ✅ Anonymous usage metrics (session duration, events captured, errors)
- ✅ Performance data (query durations, connection pool stats)
- ✅ System information (OS, VS Code version, Node.js version)
- ❌ **NEVER**: SQL queries, connection strings, passwords, database names, usernames

**Q: How is sensitive data protected?**
- All connection strings are automatically sanitized before sending
- Passwords and credentials are stripped from all telemetry
- SQL queries are never included in traces or metrics
- Error messages are sanitized to remove sensitive information

**Q: Can I see what data is being sent?**
- Yes! Check extension logs: `Ctrl+Shift+P` → "SQL Profiler: Show Logs"
- All telemetry events are logged when sent
- You can also inspect traffic to your OTLP endpoint

**Q: How do I completely disable telemetry?**
```json
{
  "sqlProfiler.telemetryEnabled": false
}
```
Or disable VS Code's global telemetry in settings.

**Q: Where is the data sent by default?**
- Default endpoint: `http://localhost:4318` (local machine only)
- If no collector is running, data is silently discarded
- No data leaves your machine unless you configure an external endpoint

## 📚 Next Steps

- Read the [full documentation](./OPENTELEMETRY-IMPLEMENTATION.md)
- Set up custom dashboards
- Configure alerts based on metrics
- Integrate with your existing observability stack

## 💡 Tips

- Start with Jaeger for simplicity
- Use sampling in high-traffic scenarios
- Set up alerts for high error rates
- Monitor connection pool health
- Track session durations over time

---

For detailed information, see [OPENTELEMETRY-IMPLEMENTATION.md](./OPENTELEMETRY-IMPLEMENTATION.md)
