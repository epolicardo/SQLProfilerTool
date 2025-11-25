# Scripts de Automatización - SQL Profiler Tool

Esta carpeta contiene scripts para automatizar tareas comunes de desarrollo y empaquetado de la extensión.

## 📦 increment-and-package - Incremento Automático de Versión

Estos scripts automatizan el proceso de:
1. Incrementar automáticamente el número de versión hotfix (patch)
2. Compilar el proyecto
3. Empaquetar la extensión con `@vscode/vsce`

### Opciones Disponibles

#### 🟢 Opción 1: Script NPM (Recomendado)
```bash
npm run package-hotfix
```

#### 🟢 Opción 2: Script Node.js Directo
```bash
node scripts/increment-and-package.js
```

#### 🟢 Opción 3: Script PowerShell (Windows)
```powershell
# Ejecutar normalmente
.\scripts\increment-and-package.ps1

# Modo dry-run (solo mostrar cambios sin aplicar)
.\scripts\increment-and-package.ps1 -DryRun
```

### 📋 Funcionamiento

**Entrada:** Versión actual en `package.json` (ej: `0.2.0`)
**Salida:** Nueva versión incrementada (ej: `0.2.1`) y archivo `.vsix` generado

#### Ejemplo de Ejecución:
```
🔄 Iniciando proceso de incremento y empaquetado...

📖 Leyendo package.json...
📊 Versión actual: 0.2.0
🚀 Nueva versión: 0.2.1
✅ package.json actualizado

🔨 Compilando proyecto...
📦 Empaquetando extensión...

🎉 Proceso completado exitosamente!
📝 Nueva versión: 0.2.1
📁 Archivo generado: sql-profiler-tool-0.2.1.vsix
```

### 🛡️ Características de Seguridad

- **Validación de formato**: Verifica que la versión tenga formato `major.minor.patch`
- **Backup automático**: No sobreescribe hasta confirmar que todo está correcto
- **Detección de errores**: Detiene el proceso si hay errores de compilación o empaquetado
- **Modo dry-run**: El script PowerShell permite simular cambios sin aplicarlos

### 🔧 Casos de Uso

#### Desarrollo Rápido de Hotfixes
```bash
# Hacer cambios de código...
# git add . && git commit -m "fix: resolver problema X"
npm run package-hotfix
# Listo para distribuir: sql-profiler-tool-0.2.X.vsix
```

#### Testing y Validación
```powershell
# Verificar qué versión se generaría
.\scripts\increment-and-package.ps1 -DryRun

# Si todo se ve bien, ejecutar realmente
.\scripts\increment-and-package.ps1
```

### 📝 Notas Importantes

1. **Versión Semántica**: Los scripts solo incrementan el número de patch (hotfix). Para cambios major/minor, edita manualmente `package.json`.

2. **Git Integration**: Los scripts no hacen commit automático. Recuerda hacer commit de los cambios de versión:
   ```bash
   git add package.json
   git commit -m "chore: bump version to 0.2.X"
   git tag v0.2.X
   ```

3. **Prerequisitos**: Asegúrate de tener instalado `@vscode/vsce`:
   ```bash
   npm install -g @vscode/vsce
   ```

### 🚨 Solución de Problemas

**Error: "Cannot find module '@vscode/vsce'"**
```bash
npm install -g @vscode/vsce
```

**Error: "vsce command not found"**
```bash
npx @vscode/vsce --version  # Verifica instalación
```

**Archivo .vsix muy grande**
- Verifica que `.vscodeignore` no esté excluyendo dependencias necesarias
- Revisa que `devDependencies` no se incluyan en el paquete final