#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Incrementa automáticamente la versión hotfix y empaqueta la extensión
 * Uso: node scripts/increment-and-package.js
 */

const PACKAGE_JSON_PATH = path.join(__dirname, '..', 'package.json');

function incrementVersion() {
    try {
        // Leer package.json
        console.log('📖 Leyendo package.json...');
        const packageData = JSON.parse(fs.readFileSync(PACKAGE_JSON_PATH, 'utf8'));
        const currentVersion = packageData.version;

        console.log(`📊 Versión actual: ${currentVersion}`);

        // Parsear versión (formato: major.minor.patch)
        const versionParts = currentVersion.split('.');
        if (versionParts.length !== 3) {
            throw new Error(`Formato de versión inválido: ${currentVersion}. Se esperaba major.minor.patch`);
        }

        const major = parseInt(versionParts[0]);
        const minor = parseInt(versionParts[1]);
        const patch = parseInt(versionParts[2]);

        // Incrementar patch (hotfix)
        const newPatch = patch + 1;
        const newVersion = `${major}.${minor}.${newPatch}`;

        console.log(`🚀 Nueva versión: ${newVersion}`);

        // Actualizar package.json
        packageData.version = newVersion;
        fs.writeFileSync(PACKAGE_JSON_PATH, JSON.stringify(packageData, null, 2) + '\n');

        console.log('✅ package.json actualizado');

        return newVersion;

    } catch (error) {
        console.error('❌ Error al incrementar versión:', error.message);
        process.exit(1);
    }
}

function packageExtension() {
    try {
        console.log('📦 Empaquetando extensión...');

        // Ejecutar vsce package
        const result = execSync('npx @vscode/vsce package', {
            cwd: path.join(__dirname, '..'),
            stdio: 'inherit'
        });

        console.log('✅ Extensión empaquetada exitosamente');

    } catch (error) {
        console.error('❌ Error al empaquetar extensión:', error.message);
        process.exit(1);
    }
}

function main() {
    console.log('🔄 Iniciando proceso de incremento y empaquetado...\n');

    const newVersion = incrementVersion();
    console.log('');

    packageExtension();
    console.log('');

    console.log(`🎉 Proceso completado exitosamente!`);
    console.log(`📝 Nueva versión: ${newVersion}`);
    console.log(`📁 Archivo generado: sql-profiler-tool-${newVersion}.vsix`);
}

// Ejecutar solo si se llama directamente (no como módulo require)
if (require.main === module) {
    main();
}

module.exports = { incrementVersion, packageExtension };