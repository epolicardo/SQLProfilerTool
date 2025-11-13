# 🔧 Corrección de Conexiones SQL Server Extension para Azure

## 📋 Tu Situación Actual

Tienes conexiones guardadas en **SQL Server Extension** (`mssql.connections`) que probablemente tienen el formato incorrecto para Azure SQL:

**Connection String de Azure Portal:**
```
Server=tcp:ordernow.database.windows.net,1433;Initial Catalog=ordernow-prod;Persist Security Info=False;User ID=epolicardo;Password={your_password};MultipleActiveResultSets=False;Encrypt=True;TrustServerCertificate=False;Connection Timeout=30;
```

**En tu VS Code `mssql.connections` (formato problemático):**
```json
{
  "profileName": "Azure OrderNow",
  "server": "tcp:ordernow.database.windows.net,1433",  // ❌ Causa error ESOCKET
  "database": "ordernow-prod",
  "authenticationType": "SqlLogin",
  "user": "epolicardo"
}
```

## ✅ Solución Automática vs Manual

### Análisis de Componentes:
- **Server**: `tcp:ordernow.database.windows.net,1433` → `ordernow.database.windows.net`
- **Database**: `ordernow-prod`  
- **User**: `epolicardo`
- **Encrypt**: `True` → `true`
- **TrustServerCertificate**: `False` → `false`
- **Connection Timeout**: `30` → `30000` (milisegundos)

### 🤖 Opción 1: Auto-Corrección (Recomendada)

**¡La extensión SQL Profiler ya maneja esto automáticamente!**

1. Usa tu conexión existente desde SQL Server Extension
2. La extensión detectará el error ESOCKET
3. Auto-corregirá `tcp:ordernow.database.windows.net,1433` → `ordernow.database.windows.net`
4. Te conectará exitosamente
5. Te sugerirá corregir la configuración permanentemente

### 🛠️ Opción 2: Corrección Manual en SQL Server Extension

Si prefieres corregir la conexión permanentemente en `mssql.connections`:

**Abre VS Code Settings:**
```
Ctrl+, → Buscar "mssql.connections" → "Edit in settings.json"
```

**Configuración Corregida:**
```json
{
  "mssql.connections": [
    {
      "profileName": "Azure OrderNow Production",
      "server": "ordernow.database.windows.net",  // ✅ Sin tcp: ni ,1433
      "database": "ordernow-prod", 
      "authenticationType": "SqlLogin",
      "user": "epolicardo",
      "encrypt": true,  // ✅ Importante para Azure SQL
      "trustServerCertificate": false,  // ✅ Para certificados Azure
      "connectTimeout": 30
    }
  ]
}
```

## 🔄 Mapeo Detallado: Azure Portal → VS Code Extension

| Azure Connection String | VS Code Settings.json |
|--------------------------|----------------------|
| `Server=tcp:ordernow.database.windows.net,1433` | `"server": "ordernow.database.windows.net"` |
| `Initial Catalog=ordernow-prod` | `"database": "ordernow-prod"` |
| `User ID=epolicardo` | `"user": "epolicardo"` |
| `Password={your_password}` | ⚠️ **NO incluir** - Se pedirá automáticamente |
| `Encrypt=True` | `"encrypt": true` |
| `TrustServerCertificate=False` | `"trustServerCertificate": false` |
| `Connection Timeout=30` | `"connectTimeout": 30000` |
| `MultipleActiveResultSets=False` | No necesario en configuración |
| `Persist Security Info=False` | No necesario en configuración |

## 🔐 Manejo de Password

**❌ NO pongas la password en settings.json:**
```json
// ❌ NUNCA hagas esto:
{
  "password": "tu_password_real"  // ¡Inseguro!
}
```

**✅ La extensión pedirá la password automáticamente:**
- Se guardará de forma segura usando `vscode.secrets`
- Solo la primera vez por conexión
- Encriptada y protegida por VS Code

## 📝 Pasos Recomendados

### 1. Usar Auto-Corrección (Más Fácil)
1. **Usa tu conexión existente** desde SQL Server Extension
2. **SQL Profiler detectará** el formato incorrecto automáticamente
3. **Se conectará** exitosamente con la corrección automática
4. **Opcionalmente actualiza** `mssql.connections` cuando te lo sugiera

### 2. Corrección Manual en SQL Server Extension
1. **Abre VS Code Settings**: `Ctrl+,`
2. **Busca**: `mssql.connections`
3. **Edita JSON**: Clic en "Edit in settings.json"
4. **Corrige el server**: Quita `tcp:` y `,1433`
5. **Agrega**: `"encrypt": true` y `"trustServerCertificate": false`
6. **Guarda** el archivo

### 3. Resultado Esperado
- La extensión detectará automáticamente el formato si tienes errores
- Te pedirá la password la primera vez
- Se guardará de forma segura para futuras conexiones

## 🚀 Funcionalidad Auto-Corrección

Si accidentalmente usas el formato original:
```json
{
  "server": "tcp:ordernow.database.windows.net,1433"  // ❌ Formato incorrecto
}
```

**La extensión automáticamente:**
1. 🔍 Detecta el formato incorrecto
2. 🔧 Auto-corrige a `ordernow.database.windows.net`
3. 🔄 Reintenta la conexión  
4. ✅ Te notifica del cambio exitoso
5. 💡 Sugiere actualizar tu configuración

## 🎯 Configuraciones Adicionales Opcionales

### Para Mejor Performance:
```json
{
  "name": "Azure OrderNow Optimized",
  "server": "ordernow.database.windows.net",
  "database": "ordernow-prod",
  "authenticationType": "SqlLogin",
  "user": "epolicardo", 
  "encrypt": true,
  "trustServerCertificate": false,
  "connectTimeout": 30000,
  "requestTimeout": 60000,
  "pool": {
    "max": 10,
    "min": 0,
    "idleTimeoutMillis": 30000
  }
}
```

### Para Debugging:
```json
{
  "name": "Azure OrderNow Debug",
  "server": "ordernow.database.windows.net", 
  "database": "ordernow-prod",
  "authenticationType": "SqlLogin",
  "user": "epolicardo",
  "encrypt": true,
  "trustServerCertificate": false,
  "connectTimeout": 60000,
  "requestTimeout": 120000,
  "debug": true
}
```

## 🔍 Verificación de Conectividad

### Test desde PowerShell:
```powershell
# Test DNS resolution
nslookup ordernow.database.windows.net

# Test port connectivity  
Test-NetConnection ordernow.database.windows.net -Port 1433
```

### Expected Output:
```
ComputerName     : ordernow.database.windows.net
RemoteAddress    : xxx.xxx.xxx.xxx
RemotePort       : 1433
InterfaceAlias   : Wi-Fi
SourceAddress    : xxx.xxx.xxx.xxx
TcpTestSucceeded : True
```

## ⚠️ Troubleshooting Checklist

- [ ] ✅ Server name sin prefijo `tcp:` ni sufijo `,1433`
- [ ] ✅ Database name correcto: `ordernow-prod`
- [ ] ✅ Usuario correcto: `epolicardo`
- [ ] ✅ `encrypt: true` para Azure SQL
- [ ] ✅ `trustServerCertificate: false` para Azure
- [ ] ✅ Firewall de Azure SQL permite tu IP
- [ ] ✅ Password correcta (se pedirá automáticamente)

¡Con esta configuración tu conexión Azure SQL debería funcionar perfectamente!