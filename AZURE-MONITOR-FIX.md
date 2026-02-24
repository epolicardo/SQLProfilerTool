# Corrección: Telemetría Application Insights

## 🔴 Problema Encontrado

**La telemetría no estaba llegando a Application Insights** porque:

1. Application Insights **NO soporta OTLP directamente**
2. Los endpoints `/v1/traces` y `/v1/metrics` no existen en Application Insights  
3. La configuración usaba exporters OTLP genéricos incompatibles con Azure

## ✅ Solución Implementada

### Migración a Azure Monitor OpenTelemetry (v0.4.1)

**Cambios realizados:**

1. **Instalado `@azure/monitor-opentelemetry@1.9.0`** - SDK oficial de Microsoft
2. **Reemplazado exporters OTLP** por Azure Monitor nativo (`useAzureMonitor`)
3. **Simplificado la configuración** - removido endpoint OTLP de package.json
4. **Limpiado dependencias** - removidas librerías innecesarias:
   - `@opentelemetry/exporter-trace-otlp-http`
   - `@opentelemetry/exporter-metrics-otlp-http`
   - `@opentelemetry/sdk-node`
   - `@opentelemetry/auto-instrumentations-node`
   - `@opentelemetry/instrumentation`
   - `@opentelemetry/resources`
   - `@opentelemetry/semantic-conventions

5. **Mantenidas solo las necesarias:**
   - `@azure/monitor-opentelemetry` (Azure Monitor SDK)
   - `@opentelemetry/api` (TypeScript types para traces y metrics)

### Archivos Modificados

- `src/utils/OpenTelemetryService.ts` - Migrado a `useAzureMonitor()`  
- `package.json` - Limpiado dependencias y configuración
- `package-lock.json` - Actualizado con nuevas dependencias

## 📊 Cómo Verificar que Funciona

### 1. Probar Localmente (Recomendado primero)

```powershell
# En VS Code, presiona F5 para iniciar la extensión en modo desarrollo
# Verifica que no haya errores en la consola

# Revisa el Output panel "Azure Monitor OpenTelemetry" para ver:
# - "Azure Monitor OpenTelemetry initialized successfully"
```

### 2. Verificar en Application Insights

Después de usar la extensión (start/stop profiling, conectar a SQL Server, capturar eventos):

1. **Ve al Azure Portal** → tu recurso de Application Insights
2. **Abre "Logs"** en el menú lateral
3. **Ejecuta esta query** en la tabla `traces`:

```kusto
traces
| where timestamp > ago(1h)
| where cloud_RoleName == "sql-server-profiler-tool"
| order by timestamp desc
| project timestamp, message, severityLevel, customDimensions
| take 100
```

4. **Para métricas**, ejecuta en la tabla `customMetrics`:

```kusto
customMetrics
| where timestamp > ago(1h)
| where cloud_RoleName == "sql-server-profiler-tool"  
| order by timestamp desc
| project timestamp, name, value, valueCount
| take 100
```

### 3. Qué Esperar Ver

**Traces (spans):**
- `extension.activate` - Al activar la extensión
- `profiler.startProfiling` - Al iniciar profiling
- `profiler.createSession` - Al crear sesión XE
- `profiler.connectUsingPool` - Al conectar a SQL Server

**Metrics:**
- `events.captured` - Counter de eventos capturados
- `query.duration` - Histogram de duración de queries
- `connection.pool.size` - Gauge de conexiones en pool
- `errors.total` - Counter de errores
- `reconnections.total` - Counter de reconexiones

**Custom Dimensions esperadas:**
- `profilerSessionName`
- `connectionProfile`
- `profilerServerType`
- `extensionVersion`
- `vscodeVersion`
- `osPlatform`

## ⚠️ Nota Importante

**Los datos pueden tardar 2-5 minutos** en aparecer en Application Insights después de ser enviados. Si no ves datos inmediatamente:

1. Espera 5 minutos
2. Verifica que `sqlProfiler.telemetryEnabled` esté en `true`
3. Verifica que VS Code telemetry global esté habilitado
4. Revisa la consola de VS Code (Help → Toggle Developer Tools) por errores

## 📝 Próximos Pasos

1. **Probar localmente** presionando F5 en VS Code
2. **Generar telemetría** usando la extensión (start/stop profiling)
3. **Verificar en App Insights** después de 5 minutos
4. Si funciona: **Publicar v0.4.1** al marketplace

## Configuración Actual

**Application Insights Connection String:**
```
InstrumentationKey=bbbe0a85-ac32-4bc3-bed1-aa51232a7843;IngestionEndpoint=https://brazilsouth-1.in.applicationinsights.azure.com/;LiveEndpoint=https://brazilsouth.livediagnostics.monitor.azure.com/;ApplicationId=ea1ee39c-7c34-4225-ae0a-1defcc009bc2
```

**Región:** Brazil South  
**Live Metrics:** Habilitado por defecto
