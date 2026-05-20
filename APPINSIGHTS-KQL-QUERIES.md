# 📊 Queries KQL para Verificar Traces en Application Insights

## Conexión a Application Insights

**Detalles:**
- **Application Insights**: brazilsouth
- **Instrumentation Key**: `bbbe0a85-ac32-4bc3-bed1-aa51232a7843`
- **URL Portal**: https://portal.azure.com
- **Región**: Brazil South

### Acceso Rápido
```
1. Portal Azure → Busca "bbbe0a85"
2. O busca "Application Insights" → brazilsouth
3. Click en "Logs" (Analytics)
4. Copia/pega las queries de abajo
```

---

## Query 1: Ver Todos los Traces (Últimas 24 horas)

```kusto
Traces
| where timestamp > ago(24h)
| project timestamp, message, severityLevel, customDimensions, sdkVersion
| order by timestamp desc
| take 100
```

**¿Qué esperas ver?**
```
timestamp              | message                | severityLevel | sdkVersion
2026-02-24 15:30:45    | extension.activate    | 0 (Info)      | undefined
2026-02-24 15:30:46    | profiler.started      | 0 (Info)      | undefined
```

---

## Query 2: Buscar Spans Específicos de SQL Profiler

```kusto
Traces
| where message contains "extension.activate" or message contains "profiler" or message contains "sql"
| where timestamp > ago(24h)
| summarize Count = count() by message, severityLevel
| order by Count desc
```

**¿Qué esperas ver?**
```
message                | severityLevel | Count
extension.activate    | 0             | 5
profiler.started      | 0             | 3
query.duration        | 0             | 12
```

---

## Query 3: Ver Métricas de Eventos Capturados

```kusto
customMetrics
| where name == "events.captured"
| where timestamp > ago(24h)
| summarize 
    TotalEvents = sum(valueCount),
    AvgValue = avg(value),
    MaxValue = max(value),
    Events = count()
by valueSum
| order by TotalEvents desc
```

**¿Qué esperas ver?**
```
valueSum | TotalEvents | AvgValue | MaxValue | Events
6.0      | 12          | 0.5      | 2        | 24
```

---

## Query 4: Duración de Queries (Histograma)

```kusto
customMetrics
| where name == "query.duration"
| where timestamp > ago(24h)
| extend duration = value
| summarize 
    Count = count(),
    Avg = avg(duration),
    Min = min(duration),
    Max = max(duration),
    P50 = percentile(duration, 50),
    P95 = percentile(duration, 95),
    P99 = percentile(duration, 99)
by tostring(bag_keys(customDimensions)[0])
```

**¿Qué esperas ver?**
```
Count | Avg    | Min | Max   | P50   | P95    | P99
143   | 125.4  | 5   | 3421  | 98    | 412    | 1203
```

---

## Query 5: Estados de Conexión del Pool

```kusto
customMetrics
| where name contains "connection.pool"
| where timestamp > ago(24h)
| extend state = tostring(customDimensions.state)
| summarize 
    Count = count(),
    Avg = avg(value),
    Max = max(value)
by state
| order by Avg desc
```

**¿Qué esperas ver?**
```
state  | Count | Avg | Max
active | 48    | 4.2 | 8
idle   | 48    | 2.1 | 5
total  | 48    | 6.3 | 10
```

---

## Query 6: Errores y Excepciones

```kusto
Exceptions
| where timestamp > ago(24h)
| summarize Count = count() by type, outerMessage
| order by Count desc
```

O para más detalle:

```kusto
Traces
| where severityLevel >= 2  // Warnings, Errors
| where timestamp > ago(24h)
| project timestamp, message, severityLevel, customDimensions
| order by timestamp desc
```

**¿Qué esperas ver?**
```
timestamp              | message                        | severityLevel
2026-02-24 15:32:10    | Failed to initialize OpenTel.. | 2 (Warning)
2026-02-24 15:33:45    | Connection timeout            | 3 (Error)
```

---

## Query 7: Resumen de Actividad Last 1 Hour

```kusto
union 
    (Traces | summarize Count = count() by "Type" = "Traces"),
    (customMetrics | summarize Count = count() by "Type" = "Metrics"),
    (Exceptions | summarize Count = count() by "Type" = "Exceptions"),
    (pageViews | summarize Count = count() by "Type" = "PageViews")
| where Count > 0
| render barchart
```

**¿Qué esperas ver?**
```
Type        | Count
Traces      | 47
Metrics     | 156
Exceptions  | 2
PageViews   | 0
```

---

## Query 8: Traces con Contexto (Atributos)

```kusto
Traces
| where timestamp > ago(24h)
| extend 
    extensionVersion = tostring(customDimensions.extensionVersion),
    vscodeVersion = tostring(customDimensions.vscodeVersion),
    eventType = tostring(customDimensions.eventType)
| summarize 
    Count = count(),
    Versions = dcount(extensionVersion)
by eventType, extensionVersion
| order by Count desc
```

**¿Qué esperas ver?**
```
eventType      | extensionVersion | Count | Versions
rpc_completed  | 0.5.0            | 34    | 1
sql_statement  | 0.5.0            | 28    | 1
select         | 0.5.0            | 15    | 1
```

---

## Query 9: Timeline  - Actividad a lo largo del tiempo

```kusto
Traces
| where timestamp > ago(24h)
| summarize Count = count() by bin(timestamp, 5m)
| render timechart with (yscale = log)
```

**Tipo de gráfico:** Series de tiempo (line chart)
- Eje X: Tiempo (5 min bins)
- Eje Y: Cantidad de traces (log scale)

---

## Query 10: Rendimiento - Bucket de Duraciones

```kusto
customMetrics
| where name == "query.duration"
| where timestamp > ago(24h)
| extend 
    durationBucket = case(
        value < 10, "0-10ms",
        value < 50, "10-50ms",
        value < 100, "50-100ms",
        value < 500, "100-500ms",
        value < 1000, "500ms-1s",
        value >= 1000, ">1s",
        "Unknown"
    )
| summarize Count = count() by durationBucket
| order by Count desc
| render piechart
```

**Tipo de gráfico:** Pie chart
- Deberías ver mayoría de queries < 100ms
- Algunos pueden estar > 1s (probablemente transacciones complejas)

---

## Cómo Usar Estas Queries

### Paso 1: Abre Application Insights

```
Azure Portal → busca Application Insights → brazilsouth
```

### Paso 2: Ve a Logs (Analytics)

```
Panel izquierdo → Logs
```

### Paso 3: Limpia la query default

```
Borra todo lo que hay por defecto
```

### Paso 4: Copia/pega una query

```
Selecciona toda la query
Ctrl+C para copiar
```

### Paso 5: Ejecuta

```
Botón "Run" o Shift+Enter
```

---

## Interpretación de Resultados

### ✅ Si ves resultados en Traces

```
✅ Azure Monitor está conectado
✅ Spans se están generando
✅ Se están enviando datos a Application Insights
✅ todo funciona correctamente
```

### ❌ Si NO ves resultados

**Causas posibles:**

1. **Application Insights vacío (normal si es reciente)**
   - Solución: Espera 2-3 minutos
   - Hay un pequeño delay en la ingesta

2. **Connection string incorrecto**
   - Solución: Verifica que sea exacto
   - Query: `Traces | where sdkVersion contains "OpenTelemetry"`

3. **Telemetría deshabilitado**
   - En VS Code: Settings → sqlProfiler → telemetryEnabled ON

4. **Problema de permisos**
   - Verifica que tengas acceso a Application Insights
   - Debes ser Owner o Reader en el resource

---

## Dashboard Recomendado

Crea un dashboard en Application Insights con estas queries:

1. **Overview**: Query #1 (últimos 100 traces)
2. **Metrics**: Query #4 (duración) + Query #5 (pool)
3. **Errors**: Query #6 (errores)
4. **Timeline**: Query #9 (actividad en tiempo)

Puedes "Pin to Dashboard" desde cada query.

---

## Quick Test

Para verificar que todo funciona, ejecuta esto:

```kusto
Traces | count
```

- **Si resultado > 0**: ✅ Datos llegando
- **Si resultado = 0**: ❌ Sin datos (espera o verifica setup)

---

**Nota**: Las queries usan `ago(24h)` = últimas 24 horas. Ajusta según necesites.
