# Incrementa automáticamente la versión hotfix y empaqueta la extensión VS Code
# Uso: .\scripts\increment-and-package.ps1

param(
    [switch]$DryRun = $false  # Si está presente, solo muestra lo que haría sin hacer cambios
)

# Configuración
$PackageJsonPath = Join-Path $PSScriptRoot ".." "package.json"
$ProjectRoot = Split-Path $PSScriptRoot -Parent

Write-Host "🔄 Iniciando proceso de incremento y empaquetado..." -ForegroundColor Cyan
Write-Host ""

try {
    # Verificar que existe package.json
    if (-not (Test-Path $PackageJsonPath)) {
        throw "No se encontró package.json en: $PackageJsonPath"
    }

    # Leer package.json
    Write-Host "📖 Leyendo package.json..." -ForegroundColor Yellow
    $packageContent = Get-Content $PackageJsonPath -Raw | ConvertFrom-Json
    $currentVersion = $packageContent.version
    
    Write-Host "📊 Versión actual: $currentVersion" -ForegroundColor Green
    
    # Parsear versión
    $versionParts = $currentVersion.Split('.')
    if ($versionParts.Length -ne 3) {
        throw "Formato de versión inválido: $currentVersion. Se esperaba major.minor.patch"
    }
    
    $major = [int]$versionParts[0]
    $minor = [int]$versionParts[1]
    $patch = [int]$versionParts[2]
    
    # Incrementar patch (hotfix)
    $newPatch = $patch + 1
    $newVersion = "$major.$minor.$newPatch"
    
    Write-Host "🚀 Nueva versión: $newVersion" -ForegroundColor Magenta
    
    if ($DryRun) {
        Write-Host "🔍 MODO DRY-RUN: No se harán cambios reales" -ForegroundColor Yellow
        Write-Host "   - Se actualizaría package.json de $currentVersion a $newVersion"
        Write-Host "   - Se ejecutaría: npx @vscode/vsce package"
        Write-Host "   - Se generaría: sql-profiler-tool-$newVersion.vsix"
        return
    }
    
    # Actualizar package.json
    $packageContent.version = $newVersion
    $jsonString = $packageContent | ConvertTo-Json -Depth 10
    $jsonString | Set-Content $PackageJsonPath -Encoding UTF8
    
    Write-Host "✅ package.json actualizado" -ForegroundColor Green
    Write-Host ""
    
    # Compilar proyecto
    Write-Host "🔨 Compilando proyecto..." -ForegroundColor Yellow
    Set-Location $ProjectRoot
    npm run compile
    
    if ($LASTEXITCODE -ne 0) {
        throw "Error en compilación"
    }
    
    # Empaquetar extensión
    Write-Host "📦 Empaquetando extensión..." -ForegroundColor Yellow
    npx "@vscode/vsce" package
    
    if ($LASTEXITCODE -ne 0) {
        throw "Error al empaquetar extensión"
    }
    
    Write-Host ""
    Write-Host "🎉 Proceso completado exitosamente!" -ForegroundColor Green
    Write-Host "📝 Nueva versión: $newVersion" -ForegroundColor Cyan
    Write-Host "📁 Archivo generado: sql-profiler-tool-$newVersion.vsix" -ForegroundColor Cyan
    
    # Mostrar información del archivo generado
    $vsixFile = "sql-profiler-tool-$newVersion.vsix"
    if (Test-Path $vsixFile) {
        $fileInfo = Get-Item $vsixFile
        Write-Host "📏 Tamaño: $([math]::Round($fileInfo.Length / 1KB, 2)) KB" -ForegroundColor Gray
        Write-Host "🕒 Creado: $($fileInfo.CreationTime)" -ForegroundColor Gray
    }
    
}
catch {
    Write-Host ""
    Write-Host "❌ Error: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}