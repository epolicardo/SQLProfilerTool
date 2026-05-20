# 🔍 Análisis de Deduplicación - SQL Profiler Tool

## Problema Identificado

El archivo `profiler-results.json` contiene **registros duplicados** del mismo evento. El usuario reporta pérdida de confianza en los datos mostrados.

### Prueba de Duplicación

Searching para: `SELECT target_data FROM sys.dm_xe_database_session_targets`

Resultado: **20 coincidencias** en el archivo para la misma consulta

### Patrón de Duplicación

Cada evento SQL se captura **TWICE**:

```json
// Evento 1: sql_statement_completed (17:35:31.693Z)
{
  "id": "evt_181_87a109bc-a87e-4b9b-ad5d-d4f687707ad3",
  "timestamp": "2026-02-24T17:35:31.693Z",
  "eventName": "sql_statement_completed",
  "statement": "SELECT target_data FROM sys.dm_xe_database_session_targets...",
  "duration": 7608
}

// Evento 2: sql_batch_completed (17:35:31.693Z) - MISMO TIMESTAMP
{
  "id": "evt_182_dd5ba112-2e40-49eb-806c-dd38a9f2765f",
  "timestamp": "2026-02-24T17:35:31.693Z",
  "eventName": "sql_batch_completed",
  "statement": "",
  "duration": 7684
}
```

## Causa Raíz

En `SqlProfilerManager.ts`, estamos configurando dos eventos Extended Events:

```sql
-- Event 1: rpc_completed (cuando termina el RPC/stored proc)
CREATE EVENT SESSION ADS_Standard_Azure 
ADD EVENT sqlserver.sql_statement_completed (...)

-- Event 2: sql_batch_completed (cuando termina el batch SQL)
ADD EVENT sqlserver.sql_batch_completed (...)
```

### ¿Por qué esto es un problema?

1. **Confusión visual**: El usuario ve la misma acción dos veces
2. **Datos redundantes**: Pérdida de confianza en integridad de datos
3. **Ruido innecesario**: Más eventos que "acciones reales"
4. **Performance**: Procesamiento innecesario

## Estrateg de Deduplicación

### Opción 1: Filtrar a Nivel de Extended Events (RECOMENDADO)
- **Ventaja**: Reduce volumen en la captura
- **Desventaja**: Menos flexible si necesitas ambos eventos
- **Implementación**: Configurar solo UN evento

### Opción 2: Deduplicación en la Aplicación
- **Ventaja**: Máxima flexibilidad
- **Implementación**: Mantener un Set de eventos ya procesados

### Opción 3: Híbrido (MEJOR SOLUCIÓN)
Combinar ambas:
1. En XE: Capturar solo `sql_statement_completed` (más específico)
2. En App: Implementar deduplicación por hash para seguridad

## Patrón Propuesto: Event Deduplication Filter

### 1. Hash-Based Deduplication

```typescript
// Crear signature única para cada evento basado en:
//   - timestamp (con granularidad a milisegundo)
//   - statement (hash SHA256)
//   - duration (debe estar en rango similar)
//   - userName + databaseName

private createEventSignature(event: ProfilerEvent): string {
  const data = `${event.timestamp}|${event.statement}|${event.userName}|${event.databaseName}`;
  return crypto.createHash('sha256').update(data).digest('hex');
}

// Mantener conjunto de eventos recientemente procesados
private recentEventSignatures = new Set<string>();

// Limpiar eventos antiguos cada N segundos
private cleanupOldSignatures() {
  const now = Date.now();
  const MAX_AGE_MS = 5000; // 5 segundos
  
  for (const [sig, timestamp] of this.signatureTimestamps) {
    if (now - timestamp > MAX_AGE_MS) {
      this.recentEventSignatures.delete(sig);
      this.signatureTimestamps.delete(sig);
    }
  }
}
```

### 2. Filtro por Statement Content

```typescript
// Filtrar eventos de XE que son "ruido del profiler":
// - Queries del sistema (sys.dm_xe_*)
// - Queries internas de monitoreo
// - Queries que consultan el mismo XE session

const INTERNAL_QUERIES = [
  'sys.dm_xe_database_session_targets',
  'sys.dm_xe_database_sessions',
  'sys.server_event_sessions',
  'sys.server_audit',
  // ... más patrones
];

function isInternalQuery(statement: string): boolean {
  return INTERNAL_QUERIES.some(q => statement.includes(q));
}
```

### 3. Event Type Preference

```typescript
// Si hay múltiples eventos en la misma ventana temporal
// Preferir sql_statement_completed sobre sql_batch_completed
// Porque es más específico

const EVENT_PRIORITY = {
  'sql_statement_completed': 1,
  'sql_batch_completed': 2,
  'rpc_completed': 1,
  'attention_received': 3
};

// Al recibir un evento, verificar si ya existe uno similar
// Si existe, reemplazarlo solo si el nuevo tiene mayor prioridad
```

## Implementación Recomendada (Orden de Ejecución)

### Fase 1: Extended Events Configuration (Nivel Captura)
- **Archivo**: `src/profiler/SqlProfilerManager.ts`
- **Cambio**: Desactivar `sql_batch_completed` si está activo
- **Mantener**: Solo `sql_statement_completed` + `rpc_completed`

### Fase 2: Application Deduplication (Nivel Aplicación)
- **Archivo**: `src/utils/deduplicationUtils.ts` (NUEVO)
- **Métodos**:
  - `createEventSignature()` - Generar hash único
  - `isDuplicate()` - Verificar si ya existe
  - `dedupicate()` - Limpiar Set antiguo

### Fase 3: Webview Filtering
- **Archivo**: `src/webview/ProfilerWebviewProvider.ts`
- **Cambio**: Aplicar filtro antes de enviar al UI

## Patrón de Filtrado (Pseudocódigo)

```typescript
// En SqlProfilerManager.processEvent()

async processEvent(event: ProfilerEvent) {
  // 1. Verificar si es query interna (sistem)
  if (this.isInternalQuery(event.statement)) {
    return; // Ignorar completamente
  }
  
  // 2. Crear firma única
  const signature = this.createEventSignature(event);
  
  // 3. Verificar si ya fue procesado recientemente
  if (this.recentEventSignatures.has(signature)) {
    return; // Ya vimos este evento
  }
  
  // 4. Es un evento nuevo - registrarlo
  this.recentEventSignatures.add(signature);
  this.signatureTimestamps.set(signature, Date.now());
  
  // 5. Limpiar signatures antiguas
  this.cleanupOldSignatures();
  
  // 6. Procesar normalmete
  this.capturedEvents.push(event);
  this.emitToWebview(event);
}
```

## Resultado Esperado

**Antes**:
```
Event 181: SELECT target_data FROM sys.dm_xe_database_session_targets (sql_statement_completed)
Event 182: [empty] (sql_batch_completed) ← DUPLICADO
Event 183: SELECT target_data FROM sys.dm_xe_database_session_targets (sql_statement_completed)
Event 184: [empty] (sql_batch_completed) ← DUPLICADO
...
Total: 100 eventos (50 reales + 50 duplicados)
```

**Después**:
```
Event 181: SELECT target_data FROM sys.dm_xe_database_session_targets
Event 182: SELECT [user business query] 
Event 183: SELECT [user business query]
...
Total: 50 eventos (ÚNICOS y RELEVANTES)
```

## Confianza Restaurada ✅

1. **Datos precisos**: Cada evento mostrado es único
2. **No hay ruido**: Solo queries relevantes
3. **Performance mejorado**: Menos procesamiento
4. **Usuario confiado**: Sabe que los datos son precisos

---

**Prioridad**: 🔴 ALTA (Afecta confiabilidad)  
**Complejidad**: 🟡 MEDIA (Implementación módular)  
**Impacto**: ⭐⭐⭐⭐⭐ (Crítico para confianza del usuario)
