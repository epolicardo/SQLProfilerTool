# 🧪 Guía de Testing Manual - Optimizaciones Fase 1

## ✅ Pre-requisitos

Antes de comenzar el testing, asegúrate de que:

1. ✅ Webpack y dependencias están instaladas:
```bash
npm install
```

2. ✅ Compilación exitosa:
```bash
npm run compile
```

3. ✅ El archivo `dist/extension.js` existe y tiene ~3.21 MB

---

## 🔍 Test 1: Verificar Compilación Webpack

### Objetivo
Confirmar que webpack compila sin errores críticos y genera el bundle optimizado.

### Pasos:
```bash
# 1. Limpiar builds anteriores
npm run clean

# 2. Compilar desde cero
npm run compile

# 3. Verificar salida
# Debe completar con "webpack compiled with X warnings" (warnings OK)
```

### Criterios de Éxito:
- ✅ Compilación termina sin errores (exit code 0)
- ✅ `dist/extension.js` existe
- ✅ `dist/extension.js.map` existe (source map)
- ✅ Warnings presentes pero no errores

### Resultado Esperado:
```
asset extension.js 3.21 MiB [emitted] [minimized]
webpack 5.x.x compiled with 11 warnings in ~60s
```

---

## 🔒 Test 2: Verificar CSP con Nonces

### Objetivo
Confirmar que el Content Security Policy usa nonces y no 'unsafe-inline'.

### Pasos:

1. **Abrir Extension Development Host**:
   - Presiona `F5` en VS Code
   - Se abrirá una nueva ventana de VS Code ("Extension Development Host")

2. **Abrir SQL Profiler**:
   - `Ctrl+Shift+P` → "SQL Profiler: Open SQL Server Profiler"
   - Panel de webview debe aparecer

3. **Abrir DevTools**:
   - En la ventana Extension Development Host:
   - `Help` → `Toggle Developer Tools`
   - O `Ctrl+Shift+I`

4. **Verificar en Console**:
   - Pestaña "Console" en DevTools
   - **NO debe haber errores CSP** como:
     ```
     Refused to execute inline script because it violates CSP
     ```

5. **Inspeccionar HTML**:
   - Pestaña "Elements" en DevTools
   - Busca el `<meta>` tag de CSP
   - Verifica que contiene: `script-src 'nonce-XXXXXXXXXX'`
   - Verifica que el `<script>` tag tiene: `nonce="XXXXXXXXXX"`

### Criterios de Éxito:
- ✅ No hay errores relacionados con CSP en Console
- ✅ CSP meta tag contiene nonce
- ✅ Script tag tiene atributo nonce matching
- ✅ NO aparece 'unsafe-inline' en CSP

### Capturas Esperadas:

**CSP Meta Tag**:
```html
<meta http-equiv="Content-Security-Policy" 
      content="script-src 'nonce-Xy7kM...'">
```

**Script Tag**:
```html
<script nonce="Xy7kM..." src="vscode-webview://..."></script>
```

---

## ⚡ Test 3: Funcionalidad Básica de Profiling

### Objetivo
Confirmar que todas las funcionalidades principales funcionan después de webpack bundling.

### Pasos:

1. **En Extension Development Host**:
   - Abre SQL Profiler (si no está abierto)

2. **Test Connection List**:
   - Dropdown "Select connection..."
   - Verifica que muestra conexiones disponibles
   - (Si no hay conexiones, configura una en mssql extension primero)

3. **Test Start Profiling**:
   - Selecciona una conexión válida
   - Click botón "Start"
   - Verifica que:
     - Estado cambia a "Running"
     - Icono cambia de ⏸ a ▶
     - Botón "Stop" se habilita

4. **Test Event Capture**:
   - Ejecuta algunas queries en SQL Server
   - Click "Refresh" en el profiler
   - Verifica que aparecen eventos en la tabla

5. **Test Filters**:
   - Escribir algo en "Search SQL..."
   - Verificar que filtra eventos
   - Cambiar filtros de Database y Event Type
   - Verificar que funcionan

6. **Test Expand/Collapse**:
   - Click en una fila de evento
   - Verificar que se expande mostrando SQL completo
   - Click nuevamente para colapsar

7. **Test Export**:
   - Click botón "Export"
   - Verificar que descarga JSON correctamente

8. **Test Stop**:
   - Click botón "Stop"
   - Verificar que profiling se detiene

### Criterios de Éxito:
- ✅ Todas las funciones responden correctamente
- ✅ No hay errores en Console
- ✅ Performance es buena (sin lag visible)
- ✅ Eventos se capturan correctamente

---

## 🧹 Test 4: Memory Cleanup (Dispose)

### Objetivo
Verificar que el método `dispose()` limpia recursos correctamente.

### Pasos:

1. **Iniciar profiling**:
   - En Extension Development Host
   - Abrir SQL Profiler
   - Iniciar profiling
   - Capturar algunos eventos

2. **Verificar en DevTools**:
   - Abrir DevTools (`Ctrl+Shift+I`)
   - Ir a pestaña "Console"
   - Ejecutar comando de verificación de memoria:
   ```javascript
   // Ver output channel logs
   ```

3. **Cerrar Extension Development Host**:
   - Cerrar la ventana completa
   - Volver a VS Code principal

4. **Verificar Logs**:
   - En VS Code principal
   - `View` → `Output`
   - Seleccionar "SQL Server Profiler" en dropdown
   - Buscar mensaje: "SqlProfilerManager disposed successfully"

### Criterios de Éxito:
- ✅ Mensaje de dispose aparece en logs
- ✅ No hay errores durante dispose
- ✅ Extension se desactiva limpiamente

---

## 📦 Test 5: Package Size (VSIX)

### Objetivo
Verificar que el .vsix generado es significativamente más pequeño.

### Pasos:

```bash
# 1. Crear package VSIX
npm run package-vsce

# 2. Verificar tamaño del archivo .vsix generado
Get-Item *.vsix | Select-Object Name, @{N='SizeMB';E={[math]::Round($_.Length/1MB,2)}}
```

### Criterios de Éxito:
- ✅ `.vsix` se genera sin errores
- ✅ Tamaño es < 10 MB (comparado con ~390 MB antes)
- ✅ Package contiene `dist/extension.js` (no `out/` ni `node_modules/`)

### Verificación Adicional:

```bash
# Extraer y verificar contenido del VSIX
Expand-Archive -Path *.vsix -DestinationPath vsix-contents -Force
Get-ChildItem vsix-contents -Recurse | Measure-Object -Property Length -Sum
```

Debe mostrar:
- ✅ Solo archivos esenciales
- ✅ `extension/dist/` presente
- ✅ `extension/node_modules/` **ausente**
- ✅ `extension/src/` **ausente** (excepto webview assets)

---

## 🔧 Test 6: Watch Mode

### Objetivo
Verificar que watch mode funciona para desarrollo iterativo.

### Pasos:

```bash
# 1. Iniciar watch mode
npm run watch

# 2. En otro terminal/panel, hacer un cambio trivial
# Por ejemplo, agregar un console.log en extension.ts
```

### Criterios de Éxito:
- ✅ Webpack detecta el cambio automáticamente
- ✅ Recompila sin intervención manual
- ✅ Muestra "webpack compiled successfully"

### Para detener:
```bash
Ctrl+C
```

---

## 📊 Test 7: Performance Benchmark

### Objetivo
Verificar que no hay degradación de performance con webpack.

### Pasos:

1. **Startup Time**:
   - Cerrar Extension Development Host si está abierto
   - Presionar `F5`
   - Medir tiempo hasta que Extension Host está listo
   - **Esperado**: < 3 segundos

2. **Profiler Open Time**:
   - `Ctrl+Shift+P` → "Open SQL Server Profiler"
   - Medir tiempo hasta que UI está visible
   - **Esperado**: < 1 segundo

3. **Event Load Time**:
   - Capturar 100+ eventos
   - Click "Refresh"
   - Medir tiempo de actualización
   - **Esperado**: < 500ms para 100 eventos

### Criterios de Éxito:
- ✅ Tiempos dentro de rangos esperados
- ✅ UI responsive, sin lag
- ✅ No hay warning de "Extension Host slow"

---

## ⚠️ Troubleshooting

### Problema: "Cannot find module 'webpack'"
**Solución**:
```bash
npm install
```

### Problema: "dist/extension.js not found"
**Solución**:
```bash
npm run compile
```

### Problema: Errores CSP en Console
**Solución**:
- Verificar que `ProfilerWebviewProvider.ts` tiene el nonce implementado
- Verificar que el script tag tiene `nonce="${nonce}"`
- Reload Extension Development Host (`Ctrl+R`)

### Problema: Extension no carga
**Solución**:
1. Verificar errores en Extension Host Output:
   - `View` → `Output` → "Extension Host"
2. Verificar que `main` en `package.json` apunta a `./dist/extension.js`
3. Recompilar: `npm run rebuild`

### Problema: Warnings de webpack
**Solución**:
- Warnings de módulos opcionales de Azure son **normales**
- NO afectan funcionalidad
- Pueden ignorarse

---

## ✅ Checklist Final

Antes de considerar testing completo, verifica:

- [ ] ✅ Test 1: Compilación exitosa
- [ ] ✅ Test 2: CSP sin errores
- [ ] ✅ Test 3: Funcionalidad completa
- [ ] ✅ Test 4: Dispose cleanup
- [ ] ✅ Test 5: Package size reducido
- [ ] ✅ Test 6: Watch mode funciona
- [ ] ✅ Test 7: Performance aceptable

**Si todos pasan**: 🎉 Optimizaciones Fase 1 validadas exitosamente!

---

## 📝 Reportar Resultados

### Template de Reporte:

```markdown
## Testing Manual - Resultados

**Fecha**: [FECHA]
**Tester**: [NOMBRE]
**Ambiente**: 
- OS: Windows 11 / macOS / Linux
- VS Code: v1.x.x
- Node: v22.x.x

### Resultados:

#### Test 1: Compilación ✅/❌
- Exit code: 0
- Warnings: 11 (expected)
- Bundle size: 3.21 MB

#### Test 2: CSP ✅/❌
- Errores CSP: Ninguno
- Nonces presentes: Sí
- 'unsafe-inline': No

#### Test 3: Funcionalidad ✅/❌
- Conexión: OK
- Start/Stop: OK
- Filtros: OK
- Export: OK

#### Test 4: Dispose ✅/❌
- Log mensaje: "disposed successfully"
- Sin errores: Sí

#### Test 5: Package ✅/❌
- VSIX generado: Sí
- Tamaño: X.XX MB

#### Test 6: Watch Mode ✅/❌
- Recompilación automática: OK

#### Test 7: Performance ✅/❌
- Startup: X.Xs
- Profiler open: X.Xs
- Event load: XMs

### Conclusión:
[Todo funcionó correctamente / Se encontraron problemas en...]

### Issues Encontrados:
1. [Describir problema si existe]
```

---

**Siguiente paso**: Una vez validado manualmente, proceder con **Fase 2: Testing Automatizado** para CI/CD.

---

*Guía preparada por GitHub Copilot - VSCode Extensions Expert*  
*SQL Server Profiler Tool v0.4.1*
