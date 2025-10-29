# SQL Server Profiler Tool

Una extensión de Visual Studio Code que proporciona capacidades de profiling de SQL Server usando Extended Events (XE) para capturar y analizar ejecuciones de consultas en tiempo real.

## Características

- ✅ **Profiling en tiempo real** usando Extended Events de SQL Server
- ✅ **Interfaz intuitiva** con webview integrado
- ✅ **Filtrado avanzado** por base de datos, tipo de evento y texto de consulta
- ✅ **Ordenamiento** de resultados por diferentes columnas
- ✅ **Exportación** de resultados en formato JSON
- ✅ **Configuración flexible** de conexión a SQL Server
- ✅ **Auto-actualización** cuando el profiling está activo

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