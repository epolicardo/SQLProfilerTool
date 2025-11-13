# 🚨 **DEBUGGING: No Events Showing - Filters Too Aggressive**

*Noviembre 5, 2025*

## 🔍 **Problema Detectado**

### **❌ Síntoma**
```
- SQL Profiler iniciado correctamente ✅
- Extended Events session creada ✅  
- Conexión a base de datos activa ✅
- Pero NO se muestran eventos ❌
```

### **🎯 Causa Probable**
Los filtros anti-recursión están siendo **demasiado agresivos** y bloqueando **TODAS las queries**, no solo las del profiler.

## 🔧 **Solución Implementada**

### **1. Filtros Simplificados Temporalmente**
```typescript
// ❌ ANTES - Filtros muy agresivos
return `AND ${appNameFilter} ${sessionNameFilter} ${additionalFilters} ${connectionTestFilters} ${nodeMssqlDriverFilters}`;

// ✅ AHORA - Solo filtros básicos
return `AND ${appNameFilter} ${sessionNameFilter}`;
```

### **2. Logs de Debugging Añadidos**
```typescript
// 📋 Log de la query completa
console.log('=== FULL QUERY ===');
console.log(query);
console.log('=== END QUERY ===');

// 📋 Log de los filtros aplicados  
console.log('=== ANTI-RECURSION FILTERS ===');
console.log(filters);
console.log('=== END FILTERS ===');
```

### **3. Filtros Básicos Activos**
```sql
-- ✅ Solo excluye profiler propio
COALESCE(
    event_data.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
    'Unknown Application'
) NOT LIKE '%SQL Profiler Tool%'

-- ✅ Solo excluye queries de sesión del profiler
AND COALESCE(
    event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
    event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
    event_data.value('(data[@name="sql_text"]/value)[1]', 'nvarchar(max)'),
    ''
) NOT LIKE '%VSCodeProfilerSession%'
```

## 🚫 **Filtros Temporalmente Deshabilitados**

### **node-mssql Driver Filters**
```sql
-- 🔧 DISABLED - Demasiado restrictivo
-- NOT LIKE '%node-mssql%'
-- NOT LIKE '%SET IMPLICIT_TRANSACTIONS%'  
-- NOT LIKE '%EXEC sp_reset_connection%'
```

### **Connection Test Filters**
```sql
-- 🔧 DISABLED - Bloqueando queries válidas
-- NOT LIKE '%SELECT 1%'
-- NOT LIKE '%SELECT @@VERSION%'  
```

### **Extended Events Filters**
```sql
-- 🔧 DISABLED - Muy agresivo
-- NOT LIKE '%sys.dm_xe_%'
-- NOT LIKE '%RingBufferTarget%'
```

## 📊 **Plan de Testing**

### **🎯 Paso 1: Validar Eventos Básicos**
```
1. Inicia el profiler con filtros simplificados
2. Ejecuta queries de prueba en tu aplicación
3. Verifica que aparecen eventos en el profiler
4. Revisa logs de debugging en consola
```

### **🔧 Paso 2: Añadir Filtros Gradualmente**
```
Una vez que veamos eventos básicos:
1. Añadir filtro node-mssql (solo application name)
2. Probar si sigue funcionando
3. Añadir filtros de connection tests  
4. Añadir filtros de Extended Events
5. Validar en cada paso
```

### **🎛️ Paso 3: Ajustar Granularidad**
```
Si algún filtro es demasiado agresivo:
1. Hacer más específico el pattern matching
2. Usar condiciones más precisas
3. Añadir excepciones para casos válidos
```

## 🐛 **Debugging Information**

### **📋 Qué Revisar en Console Log**
```javascript
// Query completa ejecutada
=== FULL QUERY ===
SELECT TOP 50...  
=== END QUERY ===

// Filtros aplicados
=== ANTI-RECURSION FILTERS ===
AND COALESCE(event_data.value...) NOT LIKE '%SQL Profiler Tool%'
=== END FILTERS ===

// Resultado de la query
Main query succeeded with X records
```

### **🔍 Diagnóstico de Problemas**
```
❌ Si records = 0:
   - Filtros demasiado restrictivos
   - No hay actividad en la base de datos
   - Extended Events session no capturando

✅ Si records > 0:
   - Filtros funcionando correctamente
   - Sistema capturando eventos
   - Revisar por qué no se muestran en UI
```

## 🎯 **Objetivo Final**

### **🏆 Balance Perfecto**
```
✅ Mostrar queries reales de aplicación
✅ Filtrar ruido del profiler propio  
✅ Filtrar operaciones internas del driver
✅ Mantener datos útiles y relevantes
```

### **📊 Métricas de Éxito**
```
- Eventos visibles: > 0 
- Queries de aplicación: Mostradas ✅
- Queries del profiler: Filtradas ✅
- Ruido del driver: Filtrado gradualmente
- Performance: Óptima
```

---

## 🚀 **Estado Actual**

**🔧 DEBUGGING MODE ACTIVO**

Los filtros están temporalmente simplificados y hay logs detallados para diagnosticar por qué no se muestran eventos.

**Próximo paso: Probar el profiler y revisar console logs para identificar el problema específico.**

---

*Los filtros serán restaurados gradualmente una vez que identifiquemos y solucionemos el problema de visibilidad de eventos.*