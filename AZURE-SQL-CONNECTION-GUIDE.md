# Azure SQL Database Connection Configuration

## 🔧 Tu Problema Específico

**Error que tienes:**
```
{
  code: 'ESOCKET',
  message: 'Failed to connect to tcp:ordernow.database.windows.net,1433:1433 - getaddrinfo ENOTFOUND tcp:ordernow.database.windows.net,1433',
  server: 'tcp:ordernow.database.windows.net,1433'
}
```

**Causa:** Formato incorrecto del nombre del servidor.

## ✅ Solución Automática (Nueva Funcionalidad)

La extensión ahora **detecta y corrige automáticamente** este error:

1. **Detecta** el formato incorrecto (`tcp:` prefix o `,1433` suffix)
2. **Auto-corrige** el nombre del servidor
3. **Reintenta** la conexión con el formato correcto
4. **Te notifica** del cambio para que actualices tu configuración

## 🛠️ Configuración Correcta para Azure SQL

### ❌ INCORRECTO (Connection String de Azure Portal)
```
Server=tcp:ordernow.database.windows.net,1433;Initial Catalog=ordernow-prod;...
```

En VS Code settings.json:
```json
{
  "name": "Azure OrderNow",
  "server": "tcp:ordernow.database.windows.net,1433",  // ❌ Formato incorrecto
  "database": "ordernow-prod",
  "authenticationType": "SqlLogin",
  "user": "epolicardo"
}
```

### ✅ CORRECTO (Convertido para VS Code Extension)
```json
{
  "name": "Azure OrderNow Production",
  "server": "ordernow.database.windows.net",  // ✅ Solo el hostname (sin tcp: ni ,1433)
  "database": "ordernow-prod",  // ✅ De "Initial Catalog"
  "authenticationType": "SqlLogin", 
  "user": "epolicardo",  // ✅ De "User ID"
  "encrypt": true,  // ✅ De "Encrypt=True"
  "trustServerCertificate": false,  // ✅ De "TrustServerCertificate=False"
  "connectTimeout": 30000,  // ✅ De "Connection Timeout=30" (en ms)
  "port": 1433  // ✅ Puerto separado (opcional, extraído de connection string)
}
```

## 📋 Pasos para Corregir tu Configuración

### 1. Abre VS Code Settings
```
Ctrl+, → Buscar "sqlProfiler.connections" → "Edit in settings.json"
```

### 2. Actualiza tu conexión Azure SQL
```json
{
  "sqlProfiler.connections": [
    {
      "name": "Azure OrderNow Database",
      "server": "ordernow.database.windows.net",
      "database": "OrderNowDB", 
      "authenticationType": "SqlLogin",
      "user": "epolicardo",
      "encrypt": true,
      "trustServerCertificate": false
    }
  ]
}
```

### 3. Elementos a REMOVER del server name:
- ❌ `tcp:` prefix
- ❌ `,1433` suffix  
- ❌ `:1433` suffix
- ❌ Cualquier prefijo de protocolo

### 4. Elementos a AGREGAR para Azure SQL:
- ✅ `"encrypt": true` (requerido para Azure SQL)
- ✅ `"trustServerCertificate": false` (validar certificados Azure)

## 🔍 Ejemplos de Configuraciones Azure SQL

### Configuración Básica
```json
{
  "name": "Mi Azure SQL",
  "server": "miservidor.database.windows.net",
  "database": "MiBaseDatos",
  "authenticationType": "SqlLogin",
  "user": "miusuario",
  "encrypt": true
}
```

### Configuración con Puerto Personalizado
```json
{
  "name": "Azure SQL Puerto Custom", 
  "server": "miservidor.database.windows.net",
  "port": 1433,
  "database": "MiBaseDatos",
  "authenticationType": "SqlLogin",
  "user": "miusuario",
  "encrypt": true,
  "trustServerCertificate": false
}
```

### Configuración para Entorno de Desarrollo  
```json
{
  "name": "Azure SQL Dev",
  "server": "dev-sql.database.windows.net", 
  "database": "DevDatabase",
  "authenticationType": "SqlLogin",
  "user": "devuser",
  "encrypt": true,
  "trustServerCertificate": false,
  "connectTimeout": 30000,
  "requestTimeout": 30000
}
```

## 🚨 Checklist de Troubleshooting Azure SQL

### 1. Formato del Servidor
- [ ] ❌ NO usar: `tcp:servidor.database.windows.net,1433`
- [ ] ✅ SÍ usar: `servidor.database.windows.net`

### 2. Configuración de Seguridad
- [ ] ✅ `"encrypt": true` está presente
- [ ] ✅ `"trustServerCertificate": false` para Azure
- [ ] ✅ Usuario y contraseña correctos

### 3. Azure SQL Server Firewall
- [ ] ✅ Tu IP está en la whitelist del Azure SQL Server
- [ ] ✅ "Allow Azure services" habilitado si conectas desde Azure
- [ ] ✅ No hay reglas de firewall corporativo bloqueando puerto 1433

### 4. Conectividad de Red
- [ ] ✅ Puedes hacer ping a `ordernow.database.windows.net`
- [ ] ✅ Puerto 1433 no está bloqueado por proxy corporativo
- [ ] ✅ VPN/conectividad a Azure si es requerida

## ⚡ Comandos Útiles para Debugging

### Test de Conectividad (PowerShell)
```powershell
# Test DNS resolution
nslookup ordernow.database.windows.net

# Test port connectivity
Test-NetConnection ordernow.database.windows.net -Port 1433
```

### Verificar Configuración en la Extensión
```
Ctrl+Shift+P → "SQL Profiler: Show Stored Passwords"
Ctrl+Shift+P → "SQL Profiler: Clear Stored Password" (si hay problemas)
```

## 🎯 Lo Que Verás Cuando Funcione

1. **Auto-corrección automática**: 
   - ⚠️ "Server name auto-corrected to ordernow.database.windows.net"
   
2. **Conexión exitosa**:
   - ✅ "Connection successful with corrected server format"
   
3. **Sugerencia de actualización**:
   - 📝 "Update your settings.json to use this format permanently"

¡Tu problema debería resolverse automáticamente con la nueva funcionalidad!