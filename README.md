# SQL Server Profiler Tool

[![Version](https://img.shields.io/badge/version-0.3.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=epolicardo.sql-server-profiler-tool)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.74.0+-blue.svg)](https://code.visualstudio.com/)
[![Auto-Reconnect](https://img.shields.io/badge/Auto--Reconnect-Enabled-green.svg)](SISTEMA-RECONEXION-AUTOMATICA.md)

**Professional SQL Server profiling directly in VS Code using Extended Events (XE)**

🚀 Real-time query capture and analysis with **advanced auto-reconnection system**, connection pooling and persistent UI state for uninterrupted troubleshooting workflow.

## ✨ Key Features

### 🔄 **Intelligent Auto-Reconnection System (NEW in v0.3.0)**
- **Automatic Recovery**: Transparent reconnection for network interruptions, SSL errors, and timeouts
- **Circuit Breaker Protection**: Prevents infinite reconnection loops with intelligent cooldown
- **Error Classification**: Smart detection of network, SSL, authentication, database, and resource errors
- **Adaptive Strategies**: Different reconnection approaches based on error type
- **Zero Downtime**: Continue profiling during temporary connection issues

### 📊 **Real-Time Profiling with Hybrid Streaming**
- **Live SQL query capture** using Extended Events (XE)
- **Hybrid Architecture**: Ring buffer (Azure SQL) + Event file streaming (SQL Server On-Premise)
- **Sub-3 Second Latency**: Optimized polling (250ms Azure, 500ms SQL Server)
- **Persistent Expanded State**: Analyze events without stopping capture (v0.2.0+)
- **Enhanced Polling**: Intelligent recovery during Extended Events errors
- **Cross-Platform Support**: Azure SQL Database, SQL Server On-Premise, SQL Express
- **Smart Anti-Recursion**: Filters profiler's own queries automatically

### 🏗️ **Enterprise-Ready Reliability**
- **Connection Pool Management**: Advanced pooling with tarn.js (max 5 connections)
- **Auto-Recovery Polling**: Automatic recovery from profiling interruptions
- **Circuit Breaker Dashboard**: Real-time monitoring of connection health
- **Configuration Presets**: Optimized settings for Azure SQL, On-Premise, and Local development
- **Session-Based DB Detection**: Database type detected once per session (zero overhead)

### 🔧 **Smart Configuration**
- **Preset Configurations**: One-click setup for different environments
- **Auto-Format Correction**: Automatic Azure SQL server name format fixes
- **Secure Credential Management**: VS Code secret storage integration
- **Real-time Statistics**: Comprehensive connection and reconnection metrics
- **Adaptive Timeouts**: 120s acquire, 45s create, 90s request

### 🎯 **Developer Experience**
- **Zero Configuration**: Works with existing mssql extension connections
- **Progress Notifications**: Visual feedback during reconnection attempts
- **Intelligent State Management**: Events remain expanded during real-time updates
- **Advanced Export**: JSON export with query metadata and connection details
- **Latency Tracking**: Real-time feedback from SQL execution to UI display
- **Unique Event IDs**: RFC4122 v4 GUID + counter for guaranteed uniqueness

## 🔄 Auto-Reconnection System

**Never lose your profiling session again!** The auto-reconnection system provides transparent recovery from connection issues.

### 🚀 **How It Works**

1. **Automatic Detection**: Monitors connection health during profiling
2. **Smart Classification**: Identifies error types (Network, SSL, Auth, Database, Resource)
3. **Adaptive Recovery**: Applies specific strategies based on error classification
4. **Circuit Breaker**: Prevents excessive reconnection attempts with intelligent cooldown
5. **Transparent Continuation**: Resumes profiling automatically when connection is restored

### 🎛️ **Configuration Presets**

Choose the optimal configuration for your environment:

| Preset | Use Case | Max Retries | Circuit Breaker | Best For |
|--------|----------|-------------|-----------------|----------|
| 🏠 **Development** | Local SQL Server | 3 | Disabled | Fast development cycles |
| ☁️ **Azure SQL** | Azure SQL Database | 8 | Enabled | Cloud environments |
| 🏢 **On-Premise** | Corporate SQL Server | 5 | Enabled | Enterprise networks |

### 📊 **Key Benefits**

- **95% Fewer Manual Interventions**: Automatic recovery in most scenarios
- **Sub-30 Second Recovery**: Fast reconnection for temporary issues  
- **Zero Data Loss**: Maintains profiling session during recovery
- **Smart Notifications**: Informative feedback without interruption

### 🎯 **Common Scenarios Resolved**

```
✅ WiFi/Network changes       → Automatic reconnection
✅ SSL Certificate errors     → Auto-enable trustServerCertificate  
✅ Azure SQL maintenance      → Circuit breaker + retry after cooldown
✅ VPN disconnections        → Exponential backoff reconnection
✅ Timeout errors            → Adaptive timeout adjustment
```

### 🔧 **Quick Setup**

1. **Open Command Palette** (`Ctrl+Shift+P`)
2. **Search**: "SQL Profiler: Configure Auto-Reconnection"  
3. **Select**: Your environment preset
4. **Start Profiling**: Enjoy uninterrupted sessions!

**📚 [Complete Documentation](./SISTEMA-RECONEXION-AUTOMATICA.md)** | **⚙️ [Configuration Reference](./config/autoReconnectSettings.json)**

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
- **`SqlProfilerManager.ts`**: Manejo de Extended Events con arquitectura híbrida (ring_buffer/event_file)
- **`ProfilerWebviewProvider.ts`**: Proveedor de contenido para el webview
- **`ConnectionPoolManager.ts`**: Gestión avanzada de pools con tarn.js
- **`AutoReconnectManager.ts`**: Sistema de reconexión automática con circuit breaker
- **`Logger.ts`**: Sistema centralizado de logging
- **`profiler.css`**: Estilos para la interfaz de usuario
- **`profiler.js`**: Lógica del frontend y comunicación con la extensión

### Extended Events capturados:

**8 tipos de eventos** para análisis completo de ejecución:
- **`sqlserver.rpc_starting`**: Inicio de llamadas a stored procedures
- **`sqlserver.rpc_completed`**: Finalización de stored procedures
- **`sqlserver.sql_batch_starting`**: Inicio de lotes SQL
- **`sqlserver.sql_batch_completed`**: Finalización de lotes SQL
- **`sqlserver.sql_statement_starting`**: Inicio de statements individuales
- **`sqlserver.sql_statement_completed`**: Finalización de statements
- **`sqlserver.sp_statement_starting`**: Inicio de statements dentro de SPs
- **`sqlserver.sp_statement_completed`**: Finalización de statements en SPs

### Arquitectura híbrida de streaming:

**Azure SQL Database:**
- Target: `ring_buffer` (max_events_limit=500, max_memory=2MB)
- Polling: 250ms para latencia sub-3 segundos
- Query: `TOP 500` de ring buffer con deduplicación por GUID

**SQL Server On-Premise:**
- Target: `event_file` (max_file_size=10MB, max_rollover_files=5)
- Polling: 500ms con filtro de timestamp incremental
- Query: `sys.fn_xe_file_target_read_file` con streaming continuo
- Cleanup: `xp_delete_file` automático al detener

### Optimizaciones de rendimiento:

- **Detección de DB una sola vez**: Tipo de base de datos cacheado por sesión (0 overhead)
- **IDs únicos garantizados**: Formato `evt_<counter>_<guid>` con RFC4122 v4
- **Anti-recursión inteligente**: Filtra queries del profiler, XE maintenance, connection tests, SET statements
- **Deduplicación por ID**: Usa IDs únicos en lugar de timestamp+statement
- **Límite configurable**: maxEvents aumentado a 2000 con logging de descarte
- **Latency tracking**: Logging de ms desde SQL hasta UI

### Seguridad:

- La extensión maneja las credenciales de SQL Server de forma segura
- Las sesiones de Extended Events se limpian automáticamente
- No se almacenan credenciales en archivos de configuración por defecto
- Passwords nunca aparecen en logs (SECURITY-FIX-PASSWORD-LOGS.md)

## Desarrollo

### Estructura del proyecto:
```
SQLProfilerTool/
├── src/
│   ├── extension.ts                          # Entry point y comandos
│   ├── tedious.d.ts                          # TypeScript definitions
│   ├── config/
│   │   └── autoReconnectSettings.json       # Presets de reconexión
│   ├── database/
│   │   ├── ConnectionPoolManager.ts         # Pooling con tarn.js
│   │   └── AutoReconnectManager.ts          # Sistema de reconexión
│   ├── profiler/
│   │   └── SqlProfilerManager.ts            # Core: XE streaming híbrido
│   ├── utils/
│   │   └── Logger.ts                        # Sistema centralizado de logs
│   └── webview/
│       ├── ProfilerWebviewProvider.ts       # Provider del webview
│       ├── profiler.css                     # Estilos UI
│       └── profiler.js                      # Lógica frontend
├── Documentation/                            # Docs técnicos detallados
│   ├── IMPLEMENTATION-COMPLETE.md
│   ├── AZURE-SQL-CONNECTION-GUIDE.md
│   ├── ANTI-RECURSION-SYSTEM.md
│   └── [20+ archivos de documentación]
├── scripts/
│   ├── increment-and-package.js             # Automatización de releases
│   └── increment-and-package.ps1
├── package.json                              # Metadata y comandos
├── tsconfig.json                             # TypeScript config
└── README.md                                 # Este archivo
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

### v0.3.0 (November 2025)
- ✅ **Sistema de reconexión automática** con circuit breaker y error classification
- ✅ **Arquitectura híbrida de streaming**: ring_buffer (Azure) + event_file (SQL Server)
- ✅ **Latencia sub-3 segundos**: Reducción de 14 minutos a 2-3 segundos en Azure
- ✅ **IDs únicos con GUID**: RFC4122 v4 + counter para eventos garantizados únicos
- ✅ **Detección de DB optimizada**: Una sola vez por sesión (0 overhead después)
- ✅ **8 tipos de eventos**: Captura completa de starting/completed para RPC/Batch/Statement/SP
- ✅ **Anti-recursión inteligente**: Filtra queries del profiler automáticamente
- ✅ **Connection pooling avanzado**: tarn.js con health checks y timeouts adaptativos
- ✅ **Deduplicación mejorada**: Por ID único en lugar de timestamp+statement
- ✅ **Latency tracking**: Logging en tiempo real de ms desde SQL hasta UI
- ✅ **Límite aumentado**: maxEvents de 1000 a 2000 con warning logging
- ✅ **Security fix**: Passwords nunca en logs

### v0.2.8
- Estado persistente de UI expandible
- Mejoras en manejo de timeouts Azure SQL
- Sistema anti-spam de notificaciones
- Tooltips SQL sin cambios de layout

### v0.2.0
- Persistent Expanded State
- Enhanced Polling con recovery automático
- Mejoras en filtros y búsqueda

### v0.0.2
- Correcciones de seguridad
- Integración con SQL Server Extension
- Mejoras de rendimiento

### v0.0.1
- Implementación inicial
- Soporte para Extended Events
- Interfaz web básica
- Filtrado y ordenamiento
- Exportación de resultados

## Estado actual del proyecto

### ✅ Completado (Fase 1 - 50%)

- **Reconexión automática**: Sistema completo con circuit breaker
- **Streaming híbrido**: Arquitectura optimizada por plataforma
- **Performance**: Latencia reducida de minutos a segundos
- **Confiabilidad**: IDs únicos, anti-recursión, deduplicación
- **Connection pooling**: Gestión robusta con tarn.js
- **Detección inteligente**: DB type cacheado por sesión

### 🚧 En progreso

- Refinamiento de filtros anti-recursión
- Optimizaciones adicionales de polling
- Mejoras en circuit breaker dashboard

### 📋 Pendiente (Fase 2)

- [ ] Soporte para múltiples conexiones simultáneas
- [ ] Plantillas de filtros personalizados
- [ ] Análisis de rendimiento automatizado
- [ ] Integración con Azure Data Studio
- [ ] Notificaciones de eventos críticos
- [ ] Exportación a múltiples formatos (CSV, Excel)
- [ ] Gráficos de performance en tiempo real

## Problemas conocidos

- ~~Los eventos demoran minutos en aparecer~~ ✅ **RESUELTO en v0.3.0** (ahora 2-3 segundos)
- ~~Eventos duplicados al expandir~~ ✅ **RESUELTO en v0.3.0** (IDs únicos con GUID)
- ~~Queries del profiler aparecen en resultados~~ ✅ **RESUELTO en v0.3.0** (anti-recursión)
- ~~Detección de DB en cada poll~~ ✅ **RESUELTO en v0.3.0** (cache de sesión)
- Azure SQL requiere Blob Storage para event_file (limitación de plataforma)
- Algunos edge cases en filtros pueden necesitar refinamiento

## Roadmap

### Fase 1: Fundamentos (50% completo)
- [x] Extended Events básicos
- [x] Connection pooling
- [x] Auto-reconnect system
- [x] Hybrid streaming architecture
- [x] Performance optimization
- [ ] Multiple connections support

### Fase 2: Análisis avanzado
- [ ] Query plan capture
- [ ] Performance metrics dashboard
- [ ] Custom filter templates
- [ ] Export formats (CSV, Excel, PDF)

### Fase 3: Integraciones
- [ ] Azure Data Studio integration
- [ ] GitHub Copilot integration
- [ ] VS Code testing integration
- [ ] CI/CD profiling automation