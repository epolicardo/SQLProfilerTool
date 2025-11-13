# SQL Server Profiler Tool - Sidebar Integration

## Nueva Funcionalidad: Icono en la Barra Lateral

A partir de la versión 0.3.0, la extensión incluye un **icono de acceso directo en la barra lateral** de Visual Studio Code para un acceso más rápido y conveniente.

## Características del Panel Lateral

### Vista del Estado
El panel lateral muestra en tiempo real:
- ✅ **Estado del Profiler**: Running (en ejecución) o Stopped (detenido)
- 🔌 **Conexión Actual**: Servidor SQL conectado
- 📊 **Contador de Eventos**: Número de eventos capturados

### Acciones Rápidas
Directamente desde el panel lateral puedes:
- 🗄️ **Abrir Profiler**: Abre la ventana principal del profiler
- ▶️ **Iniciar Profiling**: Comienza a capturar eventos
- ⏹️ **Detener Profiling**: Detiene la captura de eventos
- 🔧 **Gestionar Conexiones**: Administra tus conexiones SQL
- 🧹 **Limpiar Resultados**: Borra los eventos capturados

### Ubicación
El icono del SQL Profiler aparece en la **barra de actividades** (Activity Bar) del lado izquierdo de VS Code:

```
┌─────────────────────────────────────┐
│ 📁 Explorer                         │
│ 🔍 Search                           │
│ 🔀 Source Control                   │
│ 🐛 Run and Debug                    │
│ 📦 Extensions                       │
│ 🗄️ SQL Profiler  ← NUEVO!          │
└─────────────────────────────────────┘
```

## Uso

1. **Haz clic en el icono del SQL Profiler** en la barra lateral
2. El panel se expandirá mostrando:
   - Estado actual del profiler
   - Conexión activa (si existe)
   - Número de eventos capturados
3. **Usa las acciones rápidas** para controlar el profiler sin abrir la ventana completa

## Actualización Automática

El panel se actualiza automáticamente cuando:
- Inicias o detienes el profiling
- Se capturan nuevos eventos
- Cambias de conexión SQL

## Botón de Actualización

Si necesitas refrescar manualmente el estado, puedes:
- Hacer clic en el **icono de actualización** (🔄) en la parte superior del panel

## Integración con la Vista Principal

El panel lateral funciona en conjunto con la ventana principal del profiler:
- Ambas vistas se sincronizan automáticamente
- Los cambios en una se reflejan en la otra
- Puedes usar ambas simultáneamente para mayor flexibilidad

## Ventajas

- ✨ **Acceso Rápido**: No necesitas abrir la ventana completa para acciones simples
- 👁️ **Visibilidad Constante**: Ve el estado del profiler sin cambiar de ventana
- ⚡ **Eficiencia**: Controla el profiling mientras trabajas en tu código
- 🎯 **Productividad**: Menos clics, más desarrollo

---

## Configuración Técnica

### Archivos Involucrados
- `src/views/ProfilerViewProvider.ts`: Lógica del TreeDataProvider
- `resources/profiler-icon.svg`: Icono personalizado SVG
- `package.json`: Configuración de viewsContainers y views

### API Utilizada
- `vscode.TreeDataProvider`: Para el panel lateral
- `vscode.window.registerTreeDataProvider`: Registro del provider
- `viewsContainers.activitybar`: Contenedor en la barra de actividades

---

**¡Disfruta de la nueva funcionalidad de acceso rápido!** 🚀
