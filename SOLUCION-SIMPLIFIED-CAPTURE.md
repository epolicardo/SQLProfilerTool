# 🔧 Solución para "Simplified Capture"

## ❌ Problema
Estás viendo "Simplified Capture" en lugar del SQL real porque la consulta principal de Extended Events está fallando.

## ✅ Cambios Implementados

### 1. **Query Principal Simplificada**
- Removí expresiones XPath complejas que podrían fallar
- Uso estructura XML correcta para Extended Events
- Consulta más robusta y compatible

### 2. **Debugging Mejorado**
- Logs detallados cuando la consulta principal falla
- Muestra el XML raw para análisis
- Información específica del error SQL

### 3. **Fallback Mejorado**
- El fallback ahora también intenta capturar SQL real
- Ya no muestra solo "Simplified Capture" genérico
- Mejor manejo de campos faltantes

## 🧪 Pasos para Probar

### 1. **Reload VS Code Extension**
```
F1 → "Developer: Reload Window"
```

### 2. **Abrir Developer Console**
```
F1 → "Developer: Toggle Developer Tools"
```

### 3. **Iniciar Profiler y Ejecutar SQL**
- Conectar a tu base de datos
- Iniciar profiler 
- Ejecutar algunas consultas SQL simples

### 4. **Revisar Logs**
Busca estos mensajes en la consola:

**✅ Si funciona bien:**
```
=== EXECUTING MAIN XE QUERY ===
Main query succeeded with X records
```

**❌ Si aún falla:**
```
=== MAIN XE QUERY FAILED ===
Error message: [mensaje específico]
Raw XML sample: [contenido XML]
Fallback query succeeded with X records
```

## 🔍 Posibles Causas del Error Original

### 1. **Permisos Insuficientes**
El usuario necesita permisos para:
- `VIEW DATABASE STATE` (Azure SQL)
- `ALTER ANY EVENT SESSION` (para crear XE)

### 2. **Sintaxis XPath Incorrecta**
- Azure SQL vs SQL Server tienen diferencias sutiles
- Estructura XML puede variar entre versiones

### 3. **Sesión XE No Configurada**
- Los eventos pueden no estar capturando los campos esperados
- Ring buffer puede estar vacío

## 🚀 Próximos Pasos

1. **Probar los cambios** y reportar qué ves en los logs
2. **Si aún ves problemas**, los logs nos dirán exactamente qué está fallando
3. **Ajustar la configuración XE** según los resultados del debugging

## 📝 Información de Debugging

Si sigues viendo problemas, reporta:
- El mensaje de error exacto de los logs
- Una muestra del XML raw (si aparece)
- El tipo de conexión (Azure SQL Database, SQL Server, etc.)
- La versión de SQL Server/Azure SQL

Con esta información podremos ajustar la consulta específicamente para tu entorno.