# Guia de implementacion de telemetria

Esta guia detalla un plan incremental y seguro para agregar telemetria a la extension, preservando la privacidad y evitando regresiones funcionales.

## Etapa 0 - Preparativos y lineamientos
- Definir responsable y canal para dudas (issues o PR tag dedicado).
- Confirmar que los lineamientos de privacidad y compliance estan aprobados.
- Registrar key de Application Insights en Azure (si no existe) y documentar donde se almacenara (por ejemplo, variable de entorno `APPINSIGHTS_INSTRUMENTATIONKEY`).
- Crear issue maestro que apile las subtareas de las etapas siguientes.

## Etapa 1 - Dependencias y configuracion base
- Agregar paquete `@vscode/extension-telemetry` a `package.json` y ejecutar `npm install`.
  - [x] Instalado correctamente con `npm install @vscode/extension-telemetry --save`.
  - [x] No se detectaron errores críticos, pero sí advertencias de engine (pueden ignorarse por ahora, revisar si afectan en runtime).
- Documentar en el issue cualquier cambio de version o incompatibilidad detectada.
  - [x] Se detectó advertencia EBADENGINE por dependencias de Azure, pero la extensión sigue funcionando.
- Ajustar `tsconfig.json` si es necesario para los nuevos tipos (no deberia serlo, validar igualmente).
  - [x] No fue necesario ajustar `tsconfig.json`.
  - [x] Se instalaron tipos de VS Code y Node para máxima compatibilidad.

## Etapa 2 - Servicio centralizado de telemetria
- Crear clase `TelemetryService` dentro de `src/utils/TelemetryService.ts` con las responsabilidades:
  - [x] Archivo creado y clase implementada.
  - [x] Inicializa `TelemetryReporter` solo si la configuración del usuario y la global lo permiten.
  - [x] Métodos `sendEvent`, `sendError`, `dispose` implementados.
  - [x] Se sanitizan mensajes de error antes de enviarlos.
  - [ ] Falta adaptar para máxima compatibilidad: usar `vscode.env.isTelemetryEnabled` en vez de `telemetryLevel` (por compatibilidad con más versiones de VS Code).
  - [ ] Falta agregar pruebas unitarias básicas (mock/no-op).
  - [ ] Validar importación de tipos de `@vscode/extension-telemetry` (puede requerir declaración de tipos manual si no existen).

## Etapa 3 - Integracion con el ciclo de vida de la extension
- Modificar `activate` y `deactivate` en `src/extension.ts` para inicializar y disponer el `TelemetryService`.
  - [x] TelemetryService inicializado en `activate` y liberado en `deactivate`.
  - [x] Inicialización protegida con try/catch para evitar fallos.
  - [x] Se registra evento `extensionActivated` y `extensionDeactivated`.
  - [ ] Falta validar manualmente que la extensión siga arrancando y que los comandos existentes funcionan.

## Etapa 4 - Eventos funcionales y metrica anonima
- Instrumentar comandos principales (`startProfiling`, `stopProfiling`, `openProfiler`, `clearResults`).
  - [x] Todos los comandos principales instrumentados con eventos anónimos y errores sanitizados.
  - [x] Se usan eventos simples, sin datos sensibles ni identificadores de usuario.
  - [x] Los errores se reportan con mensajes limpios.
  - [ ] Documentar en el issue cada punto de emisión para auditoría futura.

## Etapa 5 - Configuracion de usuario y documentacion
- Agregar en `package.json` la configuracion `sqlProfiler.telemetryEnabled` (booleano, default `true`).
- Actualizar README con seccion de Telemetria y enlace a la politica de privacidad.
- Agregar entrada en CHANGELOG resaltando la incorporacion de telemetria y el opt-out.
- Verificar que el comando `sqlProfiler.showLogs` no divulgue datos sensibles.

## Etapa 6 - Pruebas y validacion de privacidad
- Ejecutar pruebas unitarias y `npm run compile`.
- Realizar sesion manual con Application Insights para observar eventos y confirmar que solo llegan campos anonimos.
- Validar comportamiento con la configuracion global de VS Code en niveles `off`, `crash`, `error`, `usage`.
- Revisar logs locales para asegurar que no se persisten tokens ni cadenas de conexion.

## Etapa 7 - Preparacion de release y monitoreo
- Actualizar notas de lanzamiento en `Documentation/CHANGELOG.md` con guidance sobre telemetria.
- Preparar plan de rollback (desactivar `sqlProfiler.telemetryEnabled` por defecto si se detecta comportamiento inesperado).
- Desplegar version previa en entorno de pruebas o insiders antes de publicar.
- Configurar alertas en Application Insights (ingesta anomala, errores altos).

## Checklist previo a merge
- [ ] PR con pruebas verdes y validacion manual adjunta.
- [ ] Revisiones aprobadas (minimo 1 revisor tecnico).
- [ ] Documentacion actualizada (README, CHANGELOG, nuevo archivo).
- [ ] Confirmacion de que no se recolecta PII.
- [ ] Confirmacion de que se respeta `telemetry.telemetryLevel`.

## Consideraciones de seguridad y privacidad
- Nunca registrar queries ni texto de comandos SQL.
- Sanear mensajes de error antes de enviarlos (regex para quitar cadenas de conexion).
- Almacenar la instrumentation key fuera del repositorio (entorno, secret store, GitHub Actions Secret).

## Siguientes pasos sugeridos
1. Abrir issues individuales para Etapa 1 y Etapa 2.
2. Ejecutar Etapa 1 y validar que el build se mantiene estable.
3. Continuar con Etapa 2 siguiendo los criterios definidos.
