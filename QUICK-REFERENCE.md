# ⚡ QUICK REFERENCE - Guía Rápida de Referencia

## 🚀 LO QUE SE ARREGLÓ EN v0.5.1

### Problema 1: 7 UPDATE duplicados
```
❌ ANTES: Veías 1 evento (los otros 6 filtrados)
✅ AHORA: Ves 7 eventos (ejecuciones paralelas)
```

### Problema 2: Traces no en Application Insights  
```
❌ ANTES: 10% de traces llegaban (por defecto)
✅ AHORA: 100% de traces llegan (fixed)
```

---

## ✅ VERIFICACIÓN RÁPIDA (5 MINUTOS)

### Paso 1: Recargar VS Code
```
Ctrl+Shift+P → "Developer: Reload Window" → Enter
```

### Paso 2: Ver logs de inicialización
```
Ctrl+Backtick → Tab "OUTPUT" → Busca "SQL Server Profiler"
```

**Deberías ver:**
```
✓ Initializing Azure Monitor OpenTelemetry
✓ useAzureMonitor() executed, result: {initialized:true}
✓ Metrics initialized successfully
```

### Paso 3: Prueba Deduplicación (Fase 1)
```sql
-- Copia y ejecuta ESTOS 3 en paralelo:
UPDATE Products SET Price = 100 WHERE ID=1;
UPDATE Products SET Price = 100 WHERE ID=2;  
UPDATE Products SET Price = 100 WHERE ID=3;
```

**Profiler debe mostrar:** 3 eventos (no 1)

### Paso 4: Prueba Telemetría (Fase 2)
```
https://portal.azure.com 
→ Application Insights 
→ brazilsouth 
→ Logs 
→ Paste: Traces | count
→ Si resultado > 0, ✅ OK
```

---

## 📁 ARCHIVOS CAMBIADOS

| Archivo | Líneas | Cambio |
|---------|--------|--------|
| `src/utils/deduplicationUtils.ts` | ~80-120 | Event ID tracking |
| `src/utils/OpenTelemetryService.ts` | 3, 27-102 | samplingRatio: 1.0 |

**Total cambios:** Mínimos, precisos, compilados ✅

---

## 🔍 QUÉ CAMBIÓ EN CÓDIGO

### Cambio 1: Deduplicación
```typescript
// ANTES
signatureCahce: Map<string, number>  // solo timestamp
if (repeat en 5seg) → FILTER

// AHORA  
signatureCache: Map<string, {timestamp, eventIds: Set}>  // + event IDs
if (repeat EN 5seg CON MISMO event ID) → FILTER
if (repeat EN 5seg CON DISTINTO event ID) → KEEP (parallel!)
```

### Cambio 2: Telemetría
```typescript
// ANTES
useAzureMonitor()  // samplingRatio default = 0.1 (10%)

// AHORA
useAzureMonitor({ 
  samplingRatio: 1.0,  // ← CRÍTICO
  instrumentationOptions: { azureSdk: true, http: true }
})
```

---

## 🐛 TROUBLESHOOTING RÁPIDO

| Problema | Solución |
|----------|----------|
| Aún ves 1 UPDATE (no 7) | Recarga VS Code + recompila |
| No hay logs en Output | Verifica que "SQL Server Profiler" esté seleccionado en dropdown |
| Traces aún no en AppInsights | Espera 2-3 minutos, luego reintenta query |
| Error al recargar | Ctrl+Shift+P → "Reload Window" |
| Quieres recompilar | `npm run compile` then reload |

---

## 🎯 TESTS DE VALIDACIÓN

### Test 1: Eventos Paralelos
```
✅ Ejecuta 5 queries iguales al mismo tiempo
✅ Deberías ver 5 events con mismo timestamp
✅ Pero DIFERENTES event IDs
```

### Test 2: True Duplicates  
```
✅ Ejecuta misma query 2 veces en 3 segundos
✅ Deberías ver 1 event (segundo filtrado)
✅ Pasados 6 segundos, ejecuta de nuevo
✅ Deberías ver 2 events (fuera del time window)
```

### Test 3: Application Insights
```
✅ Abre Application Insights en Azure Portal
✅ Ve a Logs
✅ Ejecuta: Traces | order by timestamp desc | take 10
✅ Deberías ver al menos 10 traces recientes
```

---

## 📊 QUERIES APPLICACIÓN INSIGHTS (3 MÁS IMPORTANTES)

```kusto
-- Query 1: ¿Hay algún trace?
Traces | count

-- Query 2: Últimos 20 traces
Traces 
| where timestamp > ago(1h)
| order by timestamp desc 
| take 20

-- Query 3: Duración de queries (métricas)
customMetrics
| where name == "query.duration"
| where timestamp > ago(1h)
| summarize Count=count(), Avg=avg(value), Max=max(value)
```

---

## 🔐 CREDENCIALES / INFO

```
Instrumentation Key: bbbe0a85-ac32-4bc3-bed1-aa51232a7843
Region: Brazil South
Portal: https://portal.azure.com
Extension: SQL Server Profiler Tool v0.5.1
```

---

## ⏱️ TIEMPO ESTIMADO DE VERIFICACIÓN

| Tarea | Tiempo |
|-------|--------|
| Recargar VS Code | 1 min |
| Ver logs | 1 min |
| Ejecutar test SQL | 2 min |
| Verificar AppInsights | 2 min |
| **Total** | **~6 min** |

---

## 📞 SI TIENES DUDAS

**Archivos de documentación completa:**
- [COMPLETE-VERIFICATION-CHECKLIST.md](./COMPLETE-VERIFICATION-CHECKLIST.md) - Guía detallada
- [APPINSIGHTS-KQL-QUERIES.md](./APPINSIGHTS-KQL-QUERIES.md) - 10 queries de análisis
- [EXECUTIVE-SUMMARY-v0.5.1.md](./EXECUTIVE-SUMMARY-v0.5.1.md) - Resumen técnico

---

## ✨ RESUMEN DE 1 LÍNEA

**v0.5.1:** Eventos paralelos visibles + telemetría 100% → Application Insights  
**Status:** ✅ Compilado, listo para usar, requiere reload VS Code

