# Solución para Error 10054: Connection Forcibly Closed

## ¿Qué es el Error 10054?

El error **10054** ocurre durante el handshake SSL/TLS con SQL Server:
```
mssql: Error 10054: A connection was successfully established with the server, but then an error occurred during the pre-login handshake. (provider: TCP Provider, error: 0 - An existing connection was forcibly closed by the remote host.)
```

## ✅ Solución Automática (Nueva Funcionalidad)

La extensión ahora **detecta automáticamente** este error y:

1. **Reintenta** la conexión con `trustServerCertificate: true`
2. **Muestra un mensaje de éxito** si funciona
3. **Sugiere actualizar** tu configuración permanentemente

### ¿Qué verás?

- ⚠️ **Primera conexión falla** con error 10054
- 🔄 **Retry automático** con SSL bypass
- ✅ **Conexión exitosa** con mensaje de confirmación
- 📝 **Sugerencia** para actualizar settings.json

## 🛠️ Solución Manual (Si prefieres configurarlo directamente)

### Para Servidores Locales (Recomendado)

Agrega `trustServerCertificate: true` a tu conexión en **settings.json**:

```json
{
  "sqlProfiler.connections": [
    {
      "name": "Mi SQL Local",
      "server": "localhost",
      "database": "MiBaseDeDatos",
      "authenticationType": "SqlLogin",
      "user": "sa",
      "trustServerCertificate": true  // ← Agrega esta línea
    }
  ]
}
```

### Para Servidores de Producción

**NO uses** `trustServerCertificate: true` en producción. En su lugar:

```json
{
  "name": "Producción",
  "server": "prod-server.miempresa.com",
  "encrypt": true,
  "trustServerCertificate": false  // Mantén false para validar certificados
}
```

## 🔍 Tipos de Conexiones Locales

### SQL Server Express
```json
{
  "name": "SQL Express",
  "server": "localhost\\SQLEXPRESS",
  "trustServerCertificate": true
}
```

### LocalDB
```json
{
  "name": "LocalDB",
  "server": "(localdb)\\MSSQLLocalDB",
  "trustServerCertificate": true
}
```

### Instancia Con Nombre
```json
{
  "name": "Instancia Personalizada",
  "server": "localhost\\MIINSTANCIA",
  "trustServerCertificate": true
}
```

## 📋 Pasos para Configurar

1. **Abre VS Code Settings**: `Ctrl+,`
2. **Busca**: `sqlProfiler.connections`
3. **Edita JSON**: Clic en "Edit in settings.json"
4. **Agrega** `"trustServerCertificate": true` a tu conexión
5. **Guarda** el archivo
6. **Reinicia** el profiler

## ⚡ Comandos Útiles

- **Limpiar contraseña**: `Ctrl+Shift+P` → "SQL Profiler: Clear Stored Password"
- **Ver contraseñas guardadas**: `Ctrl+Shift+P` → "SQL Profiler: Show Stored Passwords"
- **Limpiar todas las contraseñas**: `Ctrl+Shift+P` → "SQL Profiler: Clear All Stored Passwords"

## 🐛 Si el Error Persiste

1. **Verifica** que SQL Server esté ejecutándose
2. **Confirma** el nombre del servidor y puerto
3. **Revisa** las credenciales de autenticación
4. **Comprueba** las reglas de firewall
5. **Intenta** con Windows Authentication si está disponible

## 📞 Soporte

Si continúas experimentando problemas, revisa:
- Los logs en la **Output** panel de VS Code (SQL Profiler)
- La configuración de red de SQL Server
- Los certificados SSL del servidor