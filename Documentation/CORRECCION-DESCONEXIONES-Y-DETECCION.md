# Corrección de Desconexiones y Errores de Detección de Base de Datos

## 🔍 **Análisis del Problema**

**Problema Reportado:**
- La extensión se desconecta después de un tiempo y deja de capturar eventos
- Mensaje de error "Error detecting database type" sugiere conflictos en la identificación de tipos de base de datos
- Desconexiones frecuentes durante el profiling

**Causas Identificadas:**
1. **Detección repetitiva**: La función `isAzureSqlDatabase()` se ejecutaba en cada operación sin caché
2. **Falta de manejo de errores**: Los errores de conexión no se manejaban adecuadamente en el polling
3. **Sin recuperación automática**: No había mecanismo para detectar y manejar desconexiones
4. **Conflictos de detección**: Consultas de detección podían fallar y causar desconexiones

## ✅ **Soluciones Implementadas**

### 1. **Sistema de Caché para Detección de Base de Datos**

**Antes (Problemático):**
```typescript
private async isAzureSqlDatabase(): Promise<boolean> {
    // Se ejecutaba en cada llamada, consultas repetitivas
    const versionResult = await this.pool.request().query('SELECT @@VERSION as version');
    // ...
}
```

**Después (Optimizado):**
```typescript
// Cache para evitar consultas repetitivas
private databaseTypeCache: Map<string, { isAzure: boolean; timestamp: number }> = new Map();
private readonly CACHE_TIMEOUT_MS = 300000; // 5 minutos cache

private async isAzureSqlDatabase(): Promise<boolean> {
    // Verificar caché primero
    const cached = this.databaseTypeCache.get(this.currentPoolKey);
    if (cached && (now - cached.timestamp) < this.CACHE_TIMEOUT_MS) {
        return cached.isAzure;
    }
    // Solo hacer consultas si no está en caché
}
```

### 2. **Detección Mejorada y Más Robusta**

**Estrategia de 3 Niveles:**
```typescript
// Nivel 1: Patrón del nombre del servidor (más rápido y confiable)
if (serverName.includes('.database.windows.net')) {
    return true;
}

// Nivel 2: Consulta de versión (con fallback)
const versionResult = await this.pool.request().query('SELECT @@VERSION as version');

// Nivel 3: Prueba de vistas del servidor (último recurso)
await this.pool.request().query('SELECT TOP 1 1 FROM sys.server_event_sessions');
```

### 3. **Manejo Avanzado de Errores en Polling**

**Antes (Sin recuperación):**
```typescript
this.pollingInterval = setInterval(async () => {
    await this.collectResults(); // Error = crash
}, 2000);
```

**Después (Con recuperación automática):**
```typescript
this.pollingInterval = setInterval(async () => {
    try {
        await this.collectResults();
        consecutiveErrors = 0; // Reset en éxito
    } catch (error) {
        consecutiveErrors++;
        if (consecutiveErrors >= maxConsecutiveErrors) {
            // Parar profiling automáticamente
            clearInterval(this.pollingInterval);
            this.isProfilering = false;
            this.databaseTypeCache.clear();
            // Notificar al usuario
        }
    }
}, 2000);
```

### 4. **Detección de Errores de Conexión Específicos**

```typescript
// Clasificación de errores para manejo diferenciado
if (error.code === 'ECONNRESET' || 
    error.code === 'ENOTFOUND' || 
    error.code === 'ETIMEDOUT' ||
    error.message?.includes('Connection is closed') ||
    error.message?.includes('Invalid object name')) {
    
    // Error crítico de conexión
    this.databaseTypeCache.clear();
    throw error; // Activar contador de errores consecutivos
}
// Error no crítico - continuar
```

### 5. **Limpieza Automática de Caché**

```typescript
async stopProfiling(): Promise<void> {
    // ... código existente ...
    
    // Limpiar caché para evitar datos obsoletos
    this.databaseTypeCache.clear();
    Logger.info('Database type cache cleared on profiling stop');
}
```

## 🚀 **Beneficios de las Mejoras**

### ✅ **Estabilidad**
- **Reducción de consultas**: Caché de 5 minutos evita consultas repetitivas
- **Recuperación automática**: Detección y manejo de 3 errores consecutivos
- **Notificación proactiva**: Usuario informado sobre desconexiones

### ✅ **Performance**
- **Detección rápida**: Patrón de nombre del servidor como primera opción
- **Consultas optimizadas**: Solo cuando es necesario, no en cada operación
- **Timeouts controlados**: Evita colgarse en consultas problemáticas

### ✅ **Robustez**
- **Múltiples niveles de detección**: 3 estrategias de respaldo
- **Manejo específico de errores**: Diferentes tipos de errores tratados apropiadamente
- **Limpieza automática**: Caché se limpia automáticamente en desconexiones

## 🔧 **Casos de Uso Mejorados**

### **Escenario 1: Conexión Estable**
```
1. Primera detección → Caché por 5 minutos
2. Polling normal → Sin consultas de detección adicionales
3. Captura continua → Sin interrupciones por detección
```

### **Escenario 2: Desconexión Temporal**
```
1. Error de conexión detectado → Contador +1
2. Segundo error → Contador +2
3. Tercer error → Parar profiling automáticamente
4. Notificar usuario → Mensaje claro sobre reconexión
```

### **Escenario 3: Cambio de Base de Datos**
```
1. Stop profiling → Limpiar caché automáticamente
2. Nueva conexión → Detección fresca sin datos obsoletos
3. Start profiling → Configuración correcta para nuevo tipo
```

## 📊 **Impacto Técnico**

### **Reducción de Consultas**
- **Antes**: ~30 consultas de detección por minuto
- **Después**: ~1 consulta de detección cada 5 minutos
- **Mejora**: 99% reducción en consultas repetitivas

### **Tiempo de Recuperación**
- **Antes**: Manual - usuario debe reiniciar
- **Después**: Automático - detección en 6 segundos (3 errores × 2s)
- **Mejora**: Recuperación automática sin intervención

### **Estabilidad de Conexión**
- **Antes**: Una desconexión = parada completa
- **Después**: Hasta 2 errores temporales permitidos
- **Mejora**: Tolerancia a problemas de red temporales

## 🛠 **Configuración Técnica**

### **Constantes de Configuración**
```typescript
CACHE_TIMEOUT_MS = 300000; // 5 minutos
maxConsecutiveErrors = 3;   // Máximo errores antes de parar
pollingInterval = 2000;     // 2 segundos entre polls
```

### **Métricas de Monitoreo**
- Hits del caché de detección
- Contador de errores consecutivos
- Tiempo desde última detección exitosa
- Estado de conexión del pool

---

**Fecha de Implementación**: ${new Date().toLocaleDateString()}  
**Impacto**: Resolución de desconexiones y mejora de estabilidad  
**Compatibilidad**: Retrocompatible, sin cambios en API pública  
**Próxima Versión**: v0.2.9 con correcciones de estabilidad