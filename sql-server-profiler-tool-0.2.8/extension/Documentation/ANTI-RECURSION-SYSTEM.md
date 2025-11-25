# 🛡️ Sistema Anti-Recursión - SQL Profiler Tool

## Problema Identificado

Durante el uso de la extensión, se detectó que **las consultas internas del profiler aparecían en los resultados**, creando un bucle recursivo donde:

1. ✅ La extensión ejecuta una consulta para leer eventos de Extended Events
2. ❌ SQL Server registra esa consulta como un evento
3. ❌ La extensión captura su propia consulta
4. ❌ El usuario ve queries internas irrelevantes en los resultados

**Ejemplo de query problemática capturada:**
```sql
exec sp_executesql @statement=N'
    SELECT TOP 100
        event_data.value('(@timestamp)[1]', 'datetime2') AS event_timestamp,
        event_data.value('(@name)[1]', 'varchar(50)') AS event_name,
        -- [... resto de la consulta interna de la extensión ...]
```

## Solución Implementada

### 🎯 **Estrategia de Doble Filtro**

#### **1. Filtro por Application Name**
```sql
COALESCE(
    event_data.value('(action[@name="client_app_name"]/value)[1]', 'nvarchar(128)'),
    'Unknown Application'
) NOT LIKE '%SQL Profiler Tool%'
```

- **Qué hace:** Excluye consultas provenientes de conexiones identificadas como nuestra extensión
- **Cómo funciona:** Configuramos `appName: 'SQL Profiler Tool for VS Code'` en todas las conexiones
- **Nivel de protección:** 🟢 **Alto** - Identifica específicamente nuestra aplicación

#### **2. Filtro por Contenido de Query**
```sql
COALESCE(
    event_data.value('(data[@name="statement"]/value)[1]', 'nvarchar(max)'),
    event_data.value('(data[@name="batch_text"]/value)[1]', 'nvarchar(max)'),
    event_data.value('(data[@name="sql_text"]/value)[1]', 'nvarchar(max)'),
    ''
) NOT LIKE '%VSCodeProfilerSession%'
```

- **Qué hace:** Excluye cualquier query que contenga nuestro nombre de sesión interno
- **Cómo funciona:** Filtra queries que contienen `VSCodeProfilerSession`
- **Nivel de protección:** 🟡 **Medio-Alto** - Detecta patrones específicos de nuestras queries

#### **3. Filtros Adicionales de Mantenimiento**
```sql
-- Excluir consultas de mantenimiento de Extended Events
AND ... NOT LIKE '%sys.dm_xe_%'
AND ... NOT LIKE '%RingBufferTarget%'
```

- **Qué hace:** Excluye queries de administración de Extended Events
- **Nivel de protección:** 🟡 **Medio** - Reduce ruido de queries del sistema

### 🔧 **Implementación Técnica**

#### **Configuración de Conexión**
```typescript
// En connectUsingSelectedProfile()
const sqlConfig: any = {
    server: connection.server,
    database: connection.database || '',
    // ... otras opciones ...
    options: {
        // 🛡️ Identificar nuestras conexiones
        appName: 'SQL Profiler Tool for VS Code'
    }
};
```

#### **Función Anti-Recursión**
```typescript
/**
 * 🛡️ Generates SQL filter conditions to exclude profiler's own queries
 */
private getAntiRecursionFilters(): string {
    const appNameFilter = `...`;
    const sessionNameFilter = `...`;
    const additionalFilters = `...`;
    
    return `AND ${appNameFilter} AND ${sessionNameFilter} ${additionalFilters}`;
}
```

#### **Integración en Consultas**
```sql
-- Consulta principal
CROSS APPLY target_data.nodes('RingBufferTarget/event') AS events(event_data)
WHERE event_data.value('(@timestamp)[1]', 'datetime2') IS NOT NULL
  ${this.getAntiRecursionFilters()}  -- 🛡️ FILTROS APLICADOS
ORDER BY event_timestamp DESC;
```

## 📊 **Beneficios de la Solución**

### ✅ **Antes vs Después**

| **Antes** | **Después** |
|-----------|-------------|
| ❌ Consultas internas visibles | ✅ Solo queries relevantes |
| ❌ Bucle recursivo de auto-captura | ✅ Filtrado automático |
| ❌ Ruido en los resultados | ✅ Datos limpios y útiles |
| ❌ Confusión para el usuario | ✅ Experiencia clara |
| ❌ Consumo innecesario de recursos | ✅ Performance optimizada |

### 🛡️ **Niveles de Protección**

1. **🟢 Nivel 1**: Application Name - Identifica conexiones propias
2. **🟡 Nivel 2**: Session Name - Detecta queries con `VSCodeProfilerSession`
3. **🟡 Nivel 3**: System Queries - Filtra queries de administración XE
4. **🔵 Nivel 4**: Timestamp validation - Solo eventos válidos

### 🎯 **Casos Cubiertos**

✅ **Auto-captura directa**: Queries de lectura de eventos  
✅ **Queries de administración**: Creación/mantenimiento de sesiones XE  
✅ **Consultas fallback**: Queries simplificadas de respaldo  
✅ **Conexiones múltiples**: Tanto connection string como profiles MSSQL  
✅ **Diferentes tipos de SQL**: Azure SQL, SQL Server on-premise  

## 🔍 **Testing y Validación**

### **Para probar que funciona:**

1. **Iniciar profiling** en una base de datos
2. **Ejecutar queries propias** (SELECT, INSERT, etc.)
3. **Verificar resultados** - NO deben aparecer:
   - `exec sp_executesql @statement=N'SELECT TOP 100...`
   - Queries con `VSCodeProfilerSession`
   - Queries con `sys.dm_xe_`

4. **SÍ deben aparecer:**
   - Tus queries de aplicación
   - Queries de otros usuarios/aplicaciones
   - Eventos relevantes de la base de datos

### **Logs de Depuración**
La extensión incluye logs que ayudan a identificar si los filtros están funcionando:
```
=== EXECUTING MAIN XE QUERY ===
Main query succeeded with X records
=== XE RESULTS DEBUG ===
Query returned X records (sin auto-capturas)
```

## 🚀 **Impacto en Performance**

- **✅ Menos datos procesados**: Solo eventos relevantes
- **✅ Menos ruido visual**: Interfaz más limpia
- **✅ Mejor experiencia**: Usuario ve solo lo que importa
- **✅ Menos recursión**: Evita bucles de auto-captura

## 📝 **Mantenimiento Futuro**

Si se agregan nuevas queries internas o se cambian los patrones, actualizar:

1. **`getAntiRecursionFilters()`** - Agregar nuevos patrones de filtro
2. **Application Name** - Mantener coherente en todas las conexiones
3. **Session Names** - Si se cambian nombres de sesiones XE

---

**🎉 Resultado:** Sistema robusto que garantiza que el profiler solo capture eventos externos relevantes, eliminando completamente la auto-captura recursiva.