# 🔍 Diagnóstico: Por Qué No Ves Traces en Application Insights

## El Problema

Estabas inicializando OpenTelemetry y Azure Monitor, PERO los traces **no llegaban a Application Insights**. 

### Causas Identificadas

1. **`useAzureMonitor()` se ejecutaba sin verificación**
   - No capturabas el resultado
   - No había logging detallado
   - No sabías si realmente se inicializaba

2. **Faltaban parámetros críticos en la configuración**
   - `samplingRatio: 1.0` no estaba (por defecto es 0.1 = 10% de traces)
   - Sin esto, 90% de traces se descartaban
   - Las instrumentaciones no estaban habilitadas explícitamente

3. **No había logging para debuguear**
   - Sin saber si `useAzureMonitor()` funcionaba
   - Sin saber si el tracer se obtenía correctamente
   - Sin saber qué errores podría haber

---

## Cambios Realizados

### 1. Mejorada la Configuración de Azure Monitor

**Antes:**
```typescript
useAzureMonitor({
    azureMonitorExporterOptions: {
        connectionString: this.appInsightsConnectionString,
    },
    enableLiveMetrics: true,
});
```

**Ahora:**
```typescript
this.azureMonitorOptions = {
    azureMonitorExporterOptions: {
        connectionString: this.appInsightsConnectionString,
    },
    enableLiveMetrics: true,
    samplingRatio: 1.0,  // ✅ Envía 100% de traces (sin descartar)
    browserSdkLoaderOptions: {
        enabled: false,  // ✅ No queremos SDK del navegador
    },
    instrumentationOptions: {
        azureSdk: {
            enabled: true,   // ✅ Instrumentar Azure SDK calls
        },
        http: {
            enabled: true,   // ✅ Instrumentar llamadas HTTP
        },
    },
};

const result = useAzureMonitor(this.azureMonitorOptions);
```

### 2. Agregado Logging Detallado

```typescript
Logger.info('Initializing Azure Monitor OpenTelemetry with connection string');
Logger.info('useAzureMonitor() executed, result: ' + JSON.stringify({ initialized: !!result }));
Logger.info(`Tracer obtained: ${serviceName}/${serviceVersion}`);
Logger.info(`Meter obtained: ${serviceName}/${serviceVersion}`);
Logger.info('Metrics initialized successfully');
```

### 3. Mejor Manejo de Errores

```typescript
if (error instanceof Error) {
    Logger.error('Stack: ' + error.stack);
}
```

---

## Cómo Verificar Que Ahora Funciona

### Opción 1: Ver Logs en VS Code

1. **Abre la consola de VS Code** (Ctrl+Backtick)
2. **Selecciona la pestaña "SQL Server Profiler Tool"** en el Output
3. **Busca estos mensajes al recargar la extensión:**

```
ℹ️ Initializing Azure Monitor OpenTelemetry with connection string
ℹ️ useAzureMonitor() executed, result: {"initialized":true}
ℹ️ Tracer obtained: sql-server-profiler-tool/0.5.0
ℹ️ Meter obtained: sql-server-profiler-tool/0.5.0
ℹ️ Metrics initialized successfully
```

✅ Si ves estos mensajes = Azure Monitor está inicializado correctamente

### Opción 2: Verificar en Application Insights (Azure Portal)

#### Paso 1: Abre Application Insights
```
1. Dirección: https://portal.azure.com
2. Busca: "bbbe0a85-ac32" (tu App Insights)
3. O busca el resource: "brazilsouth"
```

#### Paso 2: Mira la Tabla "traces"
```
Logs Analytics → Logs → CustomEvents o Exceptions
```

#### Paso 3: Ejecuta esta query KQL
```kusto
Traces
| where message contains "extension.activate" or sdkVersion contains "sql-profiler"
| summarize Count = count() by name, message
```

**Deberías ver traces con:**
- 📌 `extension.activate`
- 📌 `profiler.start`
- 📌 `event.captured`
- 📌 Cualquier otro span que hayas creado

#### Paso 4: Mira las Métricas
```kusto
customMetrics
| where name startswith "events.captured" or name startswith "query.duration"
| summarize Count = sum(valueCount), Average = avg(value) by name
```

---

## Parámetro Crítico: samplingRatio

**ANTES:**
```typescript
// Sin samplingRatio especificado = usa default (10%)
useAzureMonitor({...});

// Resultado: Solo 1 de cada 10 traces se enviaba
10 spans creados → Solo 1 llega a Application Insights ❌
```

**AHORA:**
```typescript
samplingRatio: 1.0,  // Envía TODOS los traces

// Resultado: Todos los spans llegan
10 spans creados → Todos 10 llegan a Application Insights ✅
```

---

## Flujo de Telemetría

```
Tu Extensión
    ↓
OpenTelemetryService
    ├─ Tracer (para spans/traces)
    └─ Meter (para métricas)
    ↓
useAzureMonitor()
    ├─ BatchSpanProcessor (agrupa y envía spans)
    ├─ PeriodicExportingMetricReader (envía métricas)
    └─ AzureMonitorExporter
    ↓
Application Insights (Brazilsouth)
    ├─ Tabla: Traces (para spans)
    ├─ Tabla: CustomMetrics (para métricos)
    └─ Tabla: Exceptions (para errores)
```

---

## Qué Spans Se Generan

### 1. En `extension.ts` (Activación)
```typescript
otelService.startActiveSpan('extension.activate', {
    extensionVersion: "0.5.0",
    vscodeVersion: "1.96",
    osPlatform: "win32"
}, (span) => {
    otelService.endSpan(span);
});
```

**Resultado en Application Insights:**
- Trace con nombre: `extension.activate`
- Atributos: `extensionVersion`, `vscodeVersion`, `osPlatform`

### 2. En `SqlProfilerManager.ts` (Captura)
```typescript
const otelService = OpenTelemetryService.getInstance();
otelService.recordEventCaptured('rpc_completed', 5);
```

**Resultado:**
- Métrica: `events.captured` con valor `5`
- Atributo: `eventType: "rpc_completed"`

### 3. En `ConnectionPoolManager.ts` (Pool stats)
```typescript
otelService.updateConnectionPoolStats(5, 2, 10);
otelService.recordQueryDuration(125, { queryType: 'SELECT' });
```

**Resultado:**
- Métrica: `connection.pool.size` (5 active, 2 idle, 10 total)
- Métrica: `query.duration` (125ms, tipo SELECT)

---

## Checklist: Verificar Todo Funciona

- [ ] Ves el mensaje "Azure Monitor OpenTelemetry initialized" en los logs
- [ ] Ves "useAzureMonitor() executed" en los logs
- [ ] En Application Insights, ejecutas la query KQL y ves resultados
- [ ] Los spans contienen los atributos que esperabas
- [ ] Las métricas muestran datos (eventos capturados, duración de queries)
- [ ] Los 100 % de traces se envían (para verificar usa `samplingRatio: 1.0`)

---

## Troubleshooting

### Problema: Veo el mensaje pero no hay traces en Application Insights

**Causas:**
1. **Connection string incorrecto** - Verifica que sea el tuyo
2. **Firewall/Network** - ¿VS Code tiene acceso a internet?
3. **Credentials** - ¿La App Insights es público o tiene restricciones?
4. **Delay** - Application Insights agrega con delay. Espera 2-3 minutos

**Soluciones:**
```typescript
// Verifica que el connection string sea correcto:
const aiConnectionString = 'InstrumentationKey=bbbe0a85-ac32-4bc3-...;IngestionEndpoint=https://brazilsouth-1.in.applicationinsights.azure.com/;...';

// Console log para verificar:
Logger.info('Using AI Connection String ending with: ' + 
    aiConnectionString.substring(aiConnectionString.length - 50));
```

### Problema: "samplingRatio: 1.0" - ¿Qué significa el valor?

```typescript
samplingRatio: 0.1   // 10% sampling (descarta 90%)
samplingRatio: 0.5   // 50% sampling
samplingRatio: 1.0   // 100% sampling (todos pasan)
```

Para debugging, usa `1.0`. Para producción en alto volumen, reduce a `0.1` o `0.01`.

### Problema: Spans se generan pero son vacíos

**Causa:** Atributos no se están seteando correctamente

**Solución:** USA `startActiveSpan()` en lugar de `startSpan()`:
```typescript
// ❌ Incorrecto (no usa context)
const span = otelService.startSpan('name');

// ✅ Correcto (usa context activo)
otelService.startActiveSpan('name', {attr: 'value'}, (span) => {
    otelService.endSpan(span);
});
```

---

## Próximos Pasos

1. **Recarga VS Code** para aplicar los cambios
2. **Abre los logs** (Ctrl+Backtick)
3. **Verifica que ves los mensajes de inicialización**
4. **Abre Application Insights en Azure Portal**
5. **Ejecuta una query KQL para ver los traces**

---

**Status**: ✅ Telemetía ahora debería funcionar  
**Última verificación**: samplingRatio = 1.0 ✅  
**Logs**: Ahora incluyen detalles de debugging ✅
