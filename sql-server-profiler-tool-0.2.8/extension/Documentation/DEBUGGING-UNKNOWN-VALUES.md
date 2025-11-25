# Debugging "Unknown" Values in SQL Profiler

## Problem
El profiler se conecta exitosamente pero muestra "Unknown" en todas las columnas (timestamp, event type, database, user, duration, SQL statement).

## Mejoras Implementadas

### 1. Logging Detallado
- Se agregó logging extensivo para debug de Extended Events
- Muestra la estructura de los datos XML capturados
- Verifica si la sesión XE está capturando eventos

### 2. Consulta XML Mejorada
- Múltiples formas de extraer el texto SQL (statement, batch_text, sql_text)
- Manejo robusto de campos faltantes con COALESCE
- Extracción de metadatos mejorada (database, user, application)
- Soporte para diferentes tipos de eventos

### 3. Función de Testing
- `testBasicEventCapture()`: Verifica si XE está capturando datos
- Muestra el XML raw para debugging
- Cuenta el número de eventos capturados

### 4. Consulta de Fallback
- Si la consulta principal falla, usa una versión simplificada
- Garantiza que al menos se capturen los nombres de eventos básicos

## Pasos para Testing

### 1. Abrir Developer Console
```
F1 → "Developer: Toggle Developer Tools"
```

### 2. Iniciar Profiler
- Conectar a tu Azure SQL Database
- Iniciar el profiler
- Ejecutar algunas consultas SQL

### 3. Revisar Logs en Console
Busca estos logs en la consola:
```
=== TESTING BASIC EVENT CAPTURE ===
Target data length: [número]
XML preview (first 1000 chars): [contenido XML]
Number of events found in XML: [número]

=== XE RESULTS DEBUG ===
Query returned [número] records
Sample record structure: [campos disponibles]
Sample record values: [valores reales]
```

## Posibles Causas del Problema

### 1. **Permisos Insuficientes**
```sql
-- Verificar permisos en Azure SQL
SELECT 
    dp.name AS principal_name,
    dp.type_desc AS principal_type,
    o.name AS object_name,
    p.permission_name,
    p.state_desc AS permission_state
FROM sys.database_permissions p
JOIN sys.objects o ON p.major_id = o.object_id
JOIN sys.database_principals dp ON p.grantee_principal_id = dp.principal_id
WHERE dp.name = USER_NAME()
```

### 2. **Configuración XE Incorrecta**
- En Azure SQL Database se requieren configuraciones específicas
- Los eventos pueden tener nombres de campo diferentes

### 3. **Formato XML Diferente**
- Azure SQL vs SQL Server tienen formatos XML ligeramente diferentes
- Los campos pueden estar en ubicaciones diferentes en el XML

## Soluciones Adicionales

### Si los logs muestran "No events found"
1. Verificar que las consultas SQL se ejecuten después de iniciar el profiler
2. Revisar que el usuario tenga permisos `ALTER ANY DATABASE EVENT SESSION`
3. En Azure SQL, usar `sys.dm_xe_database_sessions` en lugar de `sys.dm_xe_sessions`

### Si el XML está vacío
```sql
-- Verificar estado de la sesión XE manualmente
SELECT 
    s.name,
    s.create_time,
    t.target_name,
    LEN(CAST(t.target_data AS nvarchar(max))) as data_length
FROM sys.dm_xe_database_sessions s
JOIN sys.dm_xe_database_session_targets t ON s.address = t.event_session_address
WHERE s.name LIKE 'VSCode_Profiler_%'
```

### Si los campos están en NULL
- Los nombres de campo pueden variar entre versiones
- Verificar el XML raw para ver la estructura real
- Ajustar las expresiones XPath según sea necesario

## Siguientes Pasos

1. **Probar con los logs habilitados**
2. **Reportar los resultados del testing básico**
3. **Si es necesario, ajustar la configuración XE específicamente para tu versión de Azure SQL**
4. **Considerar crear eventos XE personalizados si los estándar no funcionan**

## Comando de Test Manual

```sql
-- Ejecutar directamente en Azure SQL para verificar XE
DECLARE @sessionName NVARCHAR(128) = 'VSCode_Profiler_' + CAST(NEWID() AS NVARCHAR(36));

-- Ver si existen sesiones activas
SELECT name, create_time FROM sys.dm_xe_database_sessions;

-- Ver contenido del ring buffer (si existe una sesión)
SELECT 
    CAST(target_data AS XML) as xml_data,
    LEN(CAST(target_data AS NVARCHAR(MAX))) as length
FROM sys.dm_xe_database_session_targets t
JOIN sys.dm_xe_database_sessions s ON s.address = t.event_session_address
WHERE t.target_name = 'ring_buffer';
```