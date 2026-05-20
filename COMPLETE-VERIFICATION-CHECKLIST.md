# ✅ Checklist Completo de Verificación - Fase 1 & 2

## 📋 Resumen de lo Realizado

En esta sesión se ha solucionado **2 problemas críticos**:

1. **Fase 1**: Eventos duplicados en resultados del profiler (7 registros idénticos)
2. **Fase 2**: Traces no llegaban a Application Insights

Ambos se han arreglado. Este checklist te ayuda a verificar que todo funciona.

---

## 🔄 FASE 1: Verificación de Deduplicación de Eventos

### Antes del Fix
```
Problema: Al capturar 7 UPDATE paralelos, el profiler mostraba:
- El MISMO statement
- Mismo timestamp
- Mismo usuario
- Mismo database
- DIFERENTES event IDs: evt_749, evt_681, evt_621, etc.
- Resultado: Se mostraba solo 1 evento (filtraba los otros 6)
```

### Después del Fix
```
Comportamiento esperado:
- Se muestran TODOS los 7 events (son ejecuciones paralelas)
- Mismos datos excepto event IDs
- Los 7 deben ser visibles en los resultados
```

### ✅ Checklist Fase 1

- [ ] **Paso 1**: Recargar VS Code
  ```
  Click derecho en VS Code → 
  Reload Window (o Ctrl+Shift+P → Developer: Reload Window)
  ```

- [ ] **Paso 2**: Verificar compilación
  ```
  Ver que en las salidas no hay errores TypeScript
  (puede haber warnings pre-existentes, eso está OK)
  ```

- [ ] **Paso 3**: Ejecutar Test Case 1 - Parallel Updates
  
  **Script SQL**:
  ```sql
  -- Test: 7 UPDATE paralelos
  -- Expectedresult después del fix: Ver 7 registros
  
  -- En Query 1 (en otra ventana):
  UPDATE Products SET Price = Price * 1.1 
  WHERE ProductID BETWEEN 1 AND 100;
  
  -- En Query 2 (al mismo tiempo, en otra tab):
  UPDATE Products SET Price = Price * 1.1 
  WHERE ProductID BETWEEN 101 AND 200;
  
  -- In Query 3:
  UPDATE Products SET Price = Price * 1.1 
  WHERE ProductID BETWEEN 201 AND 300;
  
  -- ... etc (7 queries total)
  ```

  **Verificación**:
  - [ ] En el profiler, verás 7 registros
  - [ ] Con el MISMO timestamp
  - [ ] Pero DIFERENTES event IDs
  - [ ] Status: ✅ FIXED si ves 7 registros

- [ ] **Paso 4**: Ejecutar Test Case 2 - True Duplicates (5 segundos)
  
  **Script SQL**:
  ```sql
  -- Ejecuta esta query DOS VECES:
  SELECT * FROM PRODUCTS WHERE PRICE > 100;
  
  -- Inmediatamente después (en menos de 5 segundos)
  -- Ejecutala OTRA VEZ
  ```

  **Verificación**:
  - [ ] Primera ejecución aparece en el profiler
  - [ ] Segunda ejecución (dentro de 5seg) NO aparece (filtrada)
  - [ ] Status: ✅ CORRECT - el deduplicador funciona

- [ ] **Paso 5**: Ejecutar Test Case 3 - Same Query después de 5+ seconds
  
  **Script SQL**:
  ```sql
  -- Ejecuta:
  SELECT * FROM PRODUCTS WHERE PRICE > 100;
  
  -- Espera 6 segundos (más del time window de 5sec)
  
  -- Ejecuta la misma query de nuevo
  ```

  **Verificación**:
  - [ ] Primera ejecución aparece
  - [ ] Segunda ejecución (después de 5+ seg) aparece (fuera del time window)
  - [ ] Status: ✅ CORRECT - se permite después del window

- [ ] **Paso 6**: Ejecutar Test Case 4 - Mixed Scenario
  
  **Script SQL**:
  ```sql
  -- 3 queries paralelas al mismo tiempo (sin wait)
  SELECT COUNT(*) FROM ORDERS;
  UPDATE ORDERS SET Status = 'shipped' WHERE OrderDate > '2025-01-01';
  DELETE FROM OrderDetails WHERE OrderID NOT IN (SELECT OrderID FROM ORDERS);
  
  -- Inmediatamente (dentro de 5seg): REPEAT QUERY #1
  SELECT COUNT(*) FROM ORDERS;
  
  -- Esperar 6 segundos
  
  -- REPEAT QUERY #1 again
  SELECT COUNT(*) FROM ORDERS;
  ```

  **Verificación**:
  - [ ] Query 1: visto 2 veces (timings diferentes)
  - [ ] Query 2 & 3: visto 1 vez cada uno
  - [ ] Status: ✅ CORRECT - mix de dedup + parallel handling

---

## 📊 FASE 2: Verificación de Telemetría en Application Insights

### Antes del Fix
```
Problema: OpenTelemetry estaba inicializado pero...
- samplingRatio por defecto era 0.1 (10%)
- Solo 1 de 10 traces llegaba a Application Insights
- useAzureMonitor() no tenía config suficiente
- No había logging de debug
```

### Después del Fix
```
Soluciones aplicadas:
- samplingRatio: 1.0 (100% de traces)
- Configuración completa de Azure Monitor
- Logging de debug en cada paso
- Instrumentación de Azure SDK + HTTP
```

### ✅ Checklist Fase 2

- [ ] **Paso 1**: Recargar VS Code
  ```
  La misma recarga anterior cubre esto
  ```

- [ ] **Paso 2**: Abre el Output del Extension
  ```
  Ctrl+Backtick (abre Terminal)
  Click en "OUTPUT" tab
  Select "SQL Server Profiler" from dropdown
  ```

- [ ] **Paso 3**: Busca estos LOGS (señal de que la inicialización funcionó)
  ```
  ✅ Busca estos mensajes:
  
  [SQL Server Profiler] Initializing Azure Monitor OpenTelemetry 
                       with connection string: InstrumentationKey=bbbe0a85...
  
  [SQL Server Profiler] useAzureMonitor() executed, result: 
                       {initialized:true}
  
  [SQL Server Profiler] Tracer obtained: sql-server-profiler-tool/0.5.0
  
  [SQL Server Profiler] Meter obtained: sql-server-profiler-tool/0.5.0
  
  [SQL Server Profiler] Metrics initialized successfully
  ```

  **Si ves estos mensajes**: ✅ PHASE 2 INICIALIZACIÓN OK

- [ ] **Paso 4**: Abre Application Insights en Azure
  ```
  URL: https://portal.azure.com
  Busca: Application Insights
  Selecciona: brazilsouth
  ```

- [ ] **Paso 5**: Ve a Logs (Analytics)
  ```
  Panel izquierdo → Logs
  ```

- [ ] **Paso 6**: Ejecuta Query de verificación rápida
  ```kusto
  Traces | count
  ```
  
  **Resultados esperados**:
  - [ ] Resultado > 0 = ✅ TRACES LLEGANDO A APP INSIGHTS
  - [ ] Resultado = 0 = ⏳ Espera 2-3 minutos (delay de ingesta)

- [ ] **Paso 7**: Ejecuta Query detallada
  ```kusto
  Traces
  | where timestamp > ago(1h)
  | summarize Count = count() by message
  | order by Count desc
  | take 20
  ```

  **Deberías ver mensajes como**:
  ```
  message                        | Count
  extension.activate             | 5
  recordEventCaptured            | 34
  recordQueryDuration            | 28
  recordReconnection             | 2
  recordError                    | 1
  ```

- [ ] **Paso 8**: Verifica samplingRatio fue aplicado
  ```kusto
  Traces
  | where timestamp > ago(1h)
  | extend metadata = todynamic(tostring(customDimensions))
  | distinct tostring(metadata)
  | take 10
  ```

  **Lo que debería haber**:
  - Traces con samplingRatio información (si está en custom dims)
  - O simplemente una cantidad ALTA de traces (ya que pasamos de 10% a 100%)

- [ ] **Paso 9**: Verifica métricas de duración de queries
  ```kusto
  customMetrics
  | where name == "query.duration"
  | where timestamp > ago(1h)
  | summarize 
      Count = count(),
      Avg = avg(value),
      Max = max(value),
      P95 = percentile(value, 95)
  | render table
  ```

  **Deberías ver**:
  - Count > 0 (al menos algunos queries ejecutados)
  - Avg en rango razonable (milisegundos)
  - Max sin valores anómalos

- [ ] **Paso 10**: Verifica eventos capturados
  ```kusto
  customMetrics
  | where name == "events.captured"
  | where timestamp > ago(1h)
  | summarize 
      Count = count(),
      Total = sum(valueCount),
      Avg = avg(value)
  | render table
  ```

  **Deberías ver**:
  - Count > 0 eventos capturados
  - Total = suma de eventos
  - Confirmación de que el profiler está capturando

---

## 🔧 Si Algo NO Funciona

### Problema: Traces no aparecen en Application Insights

**Causa 1: Connection String incorrecto**
```
✓ Verifica en src/extension.ts line ~180
✓ Debe ser: InstrumentationKey=bbbe0a85-ac32-4bc3-bed1-aa51232a7843
✗ Si es diferente, actualiza y recompila
```

**Causa 2: OpenTelemetry no inicializado**
```
✓ Busca en Output los 5 mensajes de inicialización
✗ Si no están, verifica que telemetryEnabled = true en settings
```

**Causa 3: Firewall/Network**
```
✓ Verifica que puedas acceder a: 
   https://brazilsouth-1.in.applicationinsights.azure.com
✗ Si hay bloqueo, puede ser firewall corporativo
```

**Causa 4: Demora de ingesta**
```
✓ Application Insights toma 2-3 minutos en procesar
✓ Ejecuta activity y espera un poco
✗ Si después de 5+ minutos NO aparece, es un problema
```

### Problema: Deduplicación no funciona (sigues viendo 1 UPDATE en lugar de 7)

**Verificación**:
```
✓ Verifica que src/utils/deduplicationUtils.ts tenga:
  - Map<string, {timestamp: number, eventIds: Set<string>}>
  - Lógica que chequea eventIds
✗ Si falta, puede ser que no se compiló correctamente
```

**Solución**:
```
1. Limpia: npm run clean (si existe ese script)
2. Recompila: npm run compile
3. Recarga VS Code
4. Re-prueba con uno de los test cases
```

---

## 📞 Información de Contacto / Debug

### Connection String (para verificación)
```
InstrumentationKey=bbbe0a85-ac32-4bc3-bed1-aa51232a7843
EndpointUri=https://brazilsouth-1.in.applicationinsights.azure.com
```

### Application Insights Portal
```
URL: https://portal.azure.com
Busca: "Application Insights"
Región: Brazil South
```

### Archivo de logs
```
Ctrl+Backtick → Output → SQL Server Profiler
```

---

## 📈 What's Next (Próximos Pasos)

Después de verificar que TODO funciona:

- [ ] Ejecutar todos 4 test cases de Fase 1
- [ ] Verificar 10 queries de Application Insights (Fase 2)
- [ ] Si todo OK: Create release (v0.5.1)
- [ ] Si hay issues: Crea issue con detalles específicos

---

## 🎯 Resumen Rápido

| Fase | Problema | Solución | Verificación |
|------|----------|----------|--------------|
| 1 | 7 UPDATEs → 1 registro | Track event IDs en dedup | Ver 7 eventos diferentes |
| 2 | No hay traces | samplingRatio: 1.0 | Count en Logs > 0 |

Ambos fixes están compilados ✅ y listos. Solo necesitas recargar y verificar.

