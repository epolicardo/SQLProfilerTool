# SQL Server Profiler Tool

[![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=epolicardo.sql-server-profiler-tool)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/epolicardo/SQLProfilerTool/blob/HEAD/LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.74.0+-blue.svg)](https://code.visualstudio.com/)

**Professional SQL Server profiling directly in VS Code using Extended Events (XE)**

🚀 Real-time query capture and analysis with connection pooling and persistent UI state for uninterrupted troubleshooting workflow.

## ✨ Key Features

### 🔄 **Real-Time Profiling**
- Live SQL query capture using Extended Events (XE)
- **NEW in v0.2.0**: Persistent expanded state - analyze events without stopping capture
- **NEW in v0.2.0**: Connection pooling for optimal performance
- **NEW in v0.2.0**: Intelligent scroll position preservation

### 📊 **Rich Analysis Interface**  
- Expandable event details with comprehensive information
- Advanced filtering by database, event type, and query text
- Multi-column sorting with persistent preferences
- Copy SQL to clipboard or open in new VS Code tab

### 🔧 **Enterprise-Ready Architecture**
- **Connection Pool Management**: Configurable pool size, timeouts, and health checks
- **Auto-format Correction**: Automatic Azure SQL server name format fixes
- **Health Monitoring**: Automatic connection validation and recovery
- **Secure Credential Management**: Integration with VS Code secret storage

### 🎯 **Developer Experience**
- **Zero Configuration**: Works with existing mssql extension connections
- **Intelligent State Management**: Events remain expanded during real-time updates
- **Performance Optimized**: Memory-efficient event tracking with unique IDs
- **Export Capabilities**: JSON export with query metadata

## Requisitos

- Visual Studio Code 1.74.0 o superior
- SQL Server (cualquier versión que soporte Extended Events)
- Permisos para crear/administrar Extended Events en SQL Server

## Instalación

1. Clona este repositorio
2. Ejecuta `npm install` para instalar las dependencias
3. Ejecuta `npm run compile` para compilar el proyecto
4. Presiona `F5` para abrir una nueva ventana de VS Code con la extensión cargada

## Uso

### 1. Configurar conexión

**Método recomendado: Usar conexiones de mssql**

La extensión utiliza automáticamente las conexiones configuradas en la extensión oficial de SQL Server (mssql). Configura tus conexiones en `settings.json`:

```json
{
    "mssql.connections": [
        {
            "profileName": "Local SQL Server",
            "server": "localhost",
            "database": "master",
            "authenticationType": "Integrated",
            "port": 1433,
            "encrypt": false
        },
        {
            "profileName": "Remote SQL Server",
            "server": "remote-server.com",
            "database": "MyDatabase",
            "authenticationType": "SqlLogin",
            "user": "username",
            "password": "password",
            "port": 1433,
            "encrypt": true
        }
    ],
    "sqlProfiler.selectedConnection": "Local SQL Server"
}
```

**Método alternativo: Connection string**

También puedes configurar una cadena de conexión directa:

```json
{
    "sqlProfiler.connectionString": "Server=localhost;Database=master;Integrated Security=true;"
}
```

### 2. Comandos disponibles

- **SQL Profiler: Open SQL Server Profiler** - Abre la interfaz del profiler
- **SQL Profiler: Start SQL Server Profiling** - Inicia la captura de eventos
- **SQL Profiler: Stop SQL Server Profiling** - Detiene la captura
- **SQL Profiler: Clear Profiler Results** - Limpia los resultados actuales

### 3. Interfaz del Profiler

La interfaz incluye:
- **Selector de conexión**: Elige entre las conexiones mssql configuradas
- **Controles**: Botones para iniciar/parar/limpiar/exportar/actualizar
- **Barra de estado**: Indicador de estado de profiling y número de eventos
- **Filtros**: Por base de datos, tipo de evento y búsqueda de texto
- **Tabla de resultados**: Con ordenamiento por columnas
- **Contador de eventos**: Muestra el total de eventos capturados

### 4. Filtros y búsqueda

- **Filtro por base de datos**: Muestra solo eventos de una base de datos específica
- **Filtro por tipo de evento**: RPC Completed o SQL Batch Completed
- **Búsqueda de texto**: Busca en el texto de las consultas SQL
- **Ordenamiento**: Haz clic en los headers de las columnas para ordenar

## Configuración

### Parámetros disponibles:

```json
{
    "sqlProfiler.connectionString": {
        "type": "string",
        "default": "",
        "description": "Cadena de conexión de SQL Server"
    },
    "sqlProfiler.sessionName": {
        "type": "string", 
        "default": "VSCodeProfilerSession",
        "description": "Nombre de la sesión de Extended Events"
    },
    "sqlProfiler.autoStart": {
        "type": "boolean",
        "default": false,
        "description": "Iniciar profiling automáticamente al abrir archivos SQL"
    },
    "sqlProfiler.maxEvents": {
        "type": "number",
        "default": 1000,
        "description": "Número máximo de eventos a capturar"
    }
}
```

## Arquitectura técnica

### Componentes principales:

- **`extension.ts`**: Punto de entrada principal y registro de comandos
- **`SqlProfilerManager.ts`**: Manejo de Extended Events y conexión a SQL Server
- **`ProfilerWebviewProvider.ts`**: Proveedor de contenido para el webview
- **`profiler.css`**: Estilos para la interfaz de usuario
- **`profiler.js`**: Lógica del frontend y comunicación con la extensión

### Extended Events utilizados:

- **`sqlserver.rpc_completed`**: Captura llamadas a procedimientos almacenados completadas
- **`sqlserver.sql_batch_completed`**: Captura lotes de comandos SQL completados

### Seguridad:

- La extensión maneja las credenciales de SQL Server de forma segura
- Las sesiones de Extended Events se limpian automáticamente
- No se almacenan credenciales en archivos de configuración por defecto

## Desarrollo

### Estructura del proyecto:
```
ProfilerTool/
├── src/
│   ├── extension.ts
│   ├── profiler/
│   │   └── SqlProfilerManager.ts
│   ├── webview/
│   │   ├── ProfilerWebviewProvider.ts
│   │   ├── profiler.css
│   │   └── profiler.js
│   └── database/ (futuro)
├── package.json
├── tsconfig.json
└── README.md
```

### Scripts disponibles:

- `npm run compile` - Compila TypeScript
- `npm run watch` - Compila en modo watch
- `npm run test` - Ejecuta tests
- `npm run lint` - Ejecuta linting

### Contribuir

1. Fork el proyecto
2. Crea una rama para tu feature (`git checkout -b feature/AmazingFeature`)
3. Commit tus cambios (`git commit -m 'Add some AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abre un Pull Request

## Licencia

Distribuido bajo la licencia MIT. Ver `LICENSE` para más información.

## Changelog

### v0.0.1
- Implementación inicial
- Soporte para Extended Events
- Interfaz web básica
- Filtrado y ordenamiento
- Exportación de resultados

## Problemas conocidos

- Los eventos de larga duración pueden no aparecer inmediatamente
- La configuración de conexión requiere recargar la extensión
- Limitación en el número máximo de eventos para evitar problemas de memoria

## Roadmap

- [ ] Soporte para múltiples conexiones simultáneas
- [ ] Plantillas de filtros personalizados
- [ ] Análisis de rendimiento automatizado
- [ ] Integración con Azure Data Studio
- [ ] Notificaciones de eventos críticos