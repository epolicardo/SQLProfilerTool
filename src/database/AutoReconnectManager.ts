import * as vscode from 'vscode';
import { Logger } from '../utils/Logger';
import { ConnectionPoolManager, PoolConfig } from './ConnectionPoolManager';
import { OpenTelemetryService } from '../utils/OpenTelemetryService';

/**
 * Configuración para el sistema de reconexión automática
 */
export interface ReconnectConfig {
    /** Número máximo de intentos de reconexión */
    maxRetries: number;
    /** Delay inicial entre intentos (en ms) */
    initialDelay: number;
    /** Factor de backoff exponencial */
    backoffFactor: number;
    /** Delay máximo entre intentos (en ms) */
    maxDelay: number;
    /** Timeout para cada intento de conexión (en ms) */
    connectionTimeout: number;
    /** Habilitar circuit breaker */
    enableCircuitBreaker: boolean;
    /** Número de fallos consecutivos antes de activar circuit breaker */
    circuitBreakerThreshold: number;
    /** Tiempo de espera antes de intentar cerrar el circuit breaker (en ms) */
    circuitBreakerCooldown: number;
}

/**
 * Estados del Circuit Breaker
 */
enum CircuitBreakerState {
    closed = 'closed',        // Normal operation
    open = 'open',           // Failing, blocking requests
    halfOpen = 'half-open'  // Testing if service recovered
}

/**
 * Tipos de errores de conexión para estrategias específicas
 */
export enum ConnectionErrorType {
    networkError = 'network',           // DNS, timeout, unreachable
    authError = 'authentication',       // Login failed, permissions
    sslError = 'ssl',                  // Certificate, encryption issues
    databaseError = 'database',         // Database not available, syntax
    resourceError = 'resource',         // Connection pool exhausted, memory
    unknownError = 'unknown'
}

/**
 * Información sobre un intento de reconexión
 */
export interface ReconnectAttempt {
    attempt: number;
    timestamp: Date;
    errorType: ConnectionErrorType;
    errorMessage: string;
    delay: number;
    success: boolean;
}

/**
 * Callback para notificaciones de eventos de reconexión
 */
export type ReconnectEventCallback = (event: {
    type: 'attempt' | 'success' | 'failure' | 'circuit-breaker-open' | 'circuit-breaker-closed';
    poolKey: string;
    attempt?: ReconnectAttempt;
    totalAttempts?: number;
    nextDelay?: number;
}) => void;

/**
 * Manager para reconexiones automáticas con circuit breaker y estrategias adaptivas
 */
export class AutoReconnectManager {
    private static instance: AutoReconnectManager;
    private poolManager: ConnectionPoolManager;
    private reconnectStates: Map<string, {
        attempts: ReconnectAttempt[];
        currentDelay: number;
        isReconnecting: boolean;
        circuitBreakerState: CircuitBreakerState;
        circuitBreakerOpenTime?: Date;
        consecutiveFailures: number;
        lastSuccessTime: Date;
    }> = new Map();

    private eventCallbacks: Set<ReconnectEventCallback> = new Set();
    private config: ReconnectConfig;

    private constructor() {
        this.poolManager = ConnectionPoolManager.getInstance();
        this.config = this.getDefaultConfig();
        this.loadConfigFromSettings();
    }

    static getInstance(): AutoReconnectManager {
        if (!AutoReconnectManager.instance) {
            AutoReconnectManager.instance = new AutoReconnectManager();
        }
        return AutoReconnectManager.instance;
    }

    /**
     * Configuración predeterminada del sistema de reconexión
     */
    private getDefaultConfig(): ReconnectConfig {
        return {
            maxRetries: 5,
            initialDelay: 1000,      // 1 segundo
            backoffFactor: 2.0,      // Exponential backoff
            maxDelay: 30000,         // 30 segundos máximo
            connectionTimeout: 15000, // 15 segundos por intento
            enableCircuitBreaker: true,
            circuitBreakerThreshold: 3,
            circuitBreakerCooldown: 60000 // 1 minuto
        };
    }

    /**
     * Carga configuración desde VS Code settings
     */
    private loadConfigFromSettings(): void {
        const config = vscode.workspace.getConfiguration('sqlProfiler.autoReconnect');

        this.config = {
            maxRetries: config.get<number>('maxRetries') || this.config.maxRetries,
            initialDelay: config.get<number>('initialDelay') || this.config.initialDelay,
            backoffFactor: config.get<number>('backoffFactor') || this.config.backoffFactor,
            maxDelay: config.get<number>('maxDelay') || this.config.maxDelay,
            connectionTimeout: config.get<number>('connectionTimeout') || this.config.connectionTimeout,
            enableCircuitBreaker: config.get<boolean>('enableCircuitBreaker') ?? this.config.enableCircuitBreaker,
            circuitBreakerThreshold: config.get<number>('circuitBreakerThreshold') || this.config.circuitBreakerThreshold,
            circuitBreakerCooldown: config.get<number>('circuitBreakerCooldown') || this.config.circuitBreakerCooldown
        };

        Logger.info('Auto-reconnect configuration loaded', this.config);
    }

    /**
     * Registra un callback para eventos de reconexión
     */
    onReconnectEvent(callback: ReconnectEventCallback): void {
        this.eventCallbacks.add(callback);
    }

    /**
     * Desregistra un callback de eventos de reconexión
     */
    offReconnectEvent(callback: ReconnectEventCallback): void {
        this.eventCallbacks.delete(callback);
    }

    /**
     * Emite un evento de reconexión a todos los callbacks registrados
     */
    private emitEvent(event: Parameters<ReconnectEventCallback>[0]): void {
        // Enviar métricas a OpenTelemetry
        const otelService = OpenTelemetryService.getInstance();
        if (otelService?.isActive()) {
            switch (event.type) {
                case 'attempt':
                    otelService.recordReconnection(false, {
                        reconnectPoolKey: event.poolKey,
                        reconnectAttempt: event.attempt?.attempt.toString() || '0',
                        reconnectErrorType: event.attempt?.errorType || 'unknown',
                    });
                    break;
                case 'success':
                    otelService.recordReconnection(true, {
                        reconnectPoolKey: event.poolKey,
                        reconnectTotalAttempts: event.totalAttempts?.toString() || '0',
                    });
                    break;
                case 'failure':
                    otelService.recordError('reconnect_failure', {
                        reconnectPoolKey: event.poolKey,
                        reconnectTotalAttempts: event.totalAttempts?.toString() || '0',
                    });
                    break;
                case 'circuit-breaker-open':
                    otelService.recordError('circuit_breaker_opened', {
                        reconnectPoolKey: event.poolKey,
                    });
                    break;
                case 'circuit-breaker-closed':
                    otelService.recordEventCaptured('circuit_breaker_closed');
                    break;
            }
        }

        // Llamar a los callbacks registrados
        for (const callback of this.eventCallbacks) {
            try {
                callback(event);
            } catch (error) {
                Logger.error('Error in reconnect event callback:', error);
            }
        }
    }

    /**
     * Intenta obtener una conexión con reconexión automática
     */
    async getPoolWithReconnect(config: PoolConfig): Promise<{ pool: any; wasReconnected: boolean }> {
        const poolKey = this.generatePoolKey(config);

        // Verificar circuit breaker
        if (this.isCircuitBreakerOpen(poolKey)) {
            throw new Error(`Circuit breaker is open for ${poolKey}. Connection attempts blocked.`);
        }

        try {
            // Intentar obtener pool normalmente
            const pool = await this.poolManager.getPool(config);

            // Si es exitoso, resetear estado de reconexión
            this.resetReconnectState(poolKey);

            return { pool, wasReconnected: false };
        } catch (error) {
            Logger.warn(`Initial connection failed for ${poolKey}, starting auto-reconnect:`, error);

            // Iniciar proceso de reconexión
            const pool = await this.attemptReconnect(config, poolKey, error);
            return { pool, wasReconnected: true };
        }
    }

    /**
     * Proceso principal de reconexión automática
     */
    private async attemptReconnect(config: PoolConfig, poolKey: string, initialError: any): Promise<any> {
        const state = this.getOrCreateState(poolKey);

        if (state.isReconnecting) {
            throw new Error(`Reconnection already in progress for ${poolKey}`);
        }

        state.isReconnecting = true;

        try {
            for (let attempt = 1; attempt <= this.config.maxRetries; attempt++) {
                // Verificar circuit breaker en cada intento
                if (this.isCircuitBreakerOpen(poolKey)) {
                    break;
                }

                const errorType = this.classifyError(attempt === 1 ? initialError : new Error('Reconnection attempt'));
                const delay = this.calculateDelay(attempt);

                const reconnectAttempt: ReconnectAttempt = {
                    attempt,
                    timestamp: new Date(),
                    errorType,
                    errorMessage: initialError?.message || 'Connection failed',
                    delay,
                    success: false
                };

                state.attempts.push(reconnectAttempt);

                this.emitEvent({
                    type: 'attempt',
                    poolKey,
                    attempt: reconnectAttempt,
                    totalAttempts: state.attempts.length,
                    nextDelay: attempt < this.config.maxRetries ? this.calculateDelay(attempt + 1) : undefined
                });

                Logger.info(`Auto-reconnect attempt ${attempt}/${this.config.maxRetries} for ${poolKey}`, {
                    delay,
                    errorType,
                    message: reconnectAttempt.errorMessage
                });

                // Esperar el delay calculado (excepto en el primer intento)
                if (attempt > 1) {
                    await this.sleep(delay);
                }

                try {
                    // Aplicar estrategia específica según el tipo de error
                    const adjustedConfig = this.applyErrorSpecificStrategy(config, errorType, attempt);

                    // Intentar conectar con timeout específico
                    const pool = await this.attemptConnectionWithTimeout(adjustedConfig);

                    // Éxito! Marcar intento como exitoso
                    reconnectAttempt.success = true;
                    this.resetReconnectState(poolKey);

                    Logger.info(`Auto-reconnect successful for ${poolKey} after ${attempt} attempts`);

                    this.emitEvent({
                        type: 'success',
                        poolKey,
                        attempt: reconnectAttempt,
                        totalAttempts: state.attempts.length
                    });

                    return pool;

                } catch (attemptError) {
                    Logger.warn(`Auto-reconnect attempt ${attempt} failed for ${poolKey}:`, attemptError);

                    // Incrementar contador de fallos consecutivos
                    state.consecutiveFailures++;

                    // Verificar si debemos abrir el circuit breaker
                    if (this.config.enableCircuitBreaker &&
                        state.consecutiveFailures >= this.config.circuitBreakerThreshold) {
                        this.openCircuitBreaker(poolKey);
                    }

                    // Si es el último intento, preparar para lanzar error
                    if (attempt === this.config.maxRetries) {
                        reconnectAttempt.errorMessage = (attemptError as Error)?.message || 'Final attempt failed';
                    }
                }
            }

            // Todos los intentos fallaron
            this.emitEvent({
                type: 'failure',
                poolKey,
                totalAttempts: state.attempts.length
            });

            throw new Error(`Auto-reconnect failed for ${poolKey} after ${this.config.maxRetries} attempts`);

        } finally {
            state.isReconnecting = false;
        }
    }

    /**
     * Clasifica el tipo de error para aplicar estrategias específicas
     */
    private classifyError(error: any): ConnectionErrorType {
        const errorMessage = error?.message?.toLowerCase() || '';
        const errorCode = error?.code;

        // Errores de red/DNS
        if (errorCode === 'ENOTFOUND' || errorCode === 'ECONNREFUSED' ||
            errorCode === 'ETIMEOUT' || errorCode === 'EHOSTUNREACH' ||
            errorMessage.includes('timeout') || errorMessage.includes('network')) {
            return ConnectionErrorType.networkError;
        }

        // Errores de autenticación
        if (errorCode === 18456 || errorMessage.includes('login failed') ||
            errorMessage.includes('authentication') || errorMessage.includes('permission')) {
            return ConnectionErrorType.authError;
        }

        // Errores SSL/TLS
        if (errorCode === 10054 || errorMessage.includes('ssl') ||
            errorMessage.includes('tls') || errorMessage.includes('certificate') ||
            errorMessage.includes('handshake')) {
            return ConnectionErrorType.sslError;
        }

        // Errores de base de datos
        if (errorMessage.includes('database') || errorMessage.includes('server') ||
            errorCode >= 50000) {
            return ConnectionErrorType.databaseError;
        }

        // Errores de recursos
        if (errorMessage.includes('pool') || errorMessage.includes('memory') ||
            errorMessage.includes('resource')) {
            return ConnectionErrorType.resourceError;
        }

        return ConnectionErrorType.unknownError;
    }

    /**
     * Aplica estrategias específicas según el tipo de error
     */
    private applyErrorSpecificStrategy(config: PoolConfig, errorType: ConnectionErrorType, attempt: number): PoolConfig {
        const adjustedConfig = { ...config };

        switch (errorType) {
            case ConnectionErrorType.sslError:
                // Para errores SSL, intentar con trustServerCertificate: true
                if (attempt === 2) {
                    adjustedConfig.trustServerCertificate = true;
                    Logger.info(`SSL error strategy: enabling trustServerCertificate for attempt ${attempt}`);
                }
                break;

            case ConnectionErrorType.networkError:
                // Para errores de red, aumentar timeouts gradualmente
                adjustedConfig.createTimeout = (config.createTimeout || 30000) * attempt;
                Logger.info(`Network error strategy: increasing timeout to ${adjustedConfig.createTimeout}ms for attempt ${attempt}`);
                break;

            case ConnectionErrorType.resourceError:
                // Para errores de recursos, reducir pool size
                adjustedConfig.maxConnections = Math.max(1, (config.maxConnections || 5) - attempt);
                Logger.info(`Resource error strategy: reducing maxConnections to ${adjustedConfig.maxConnections} for attempt ${attempt}`);
                break;

            case ConnectionErrorType.databaseError:
                // Para errores de DB, intentar con database master si no es la primera vez
                if (attempt > 1 && config.database !== 'master') {
                    adjustedConfig.database = 'master';
                    Logger.info(`Database error strategy: switching to master database for attempt ${attempt}`);
                }
                break;

            default:
                // Para errores desconocidos, configuración conservadora
                adjustedConfig.trustServerCertificate = true;
                adjustedConfig.createTimeout = (config.createTimeout || 30000) * 1.5;
                break;
        }

        return adjustedConfig;
    }

    /**
     * Intenta conexión con timeout específico
     */
    private async attemptConnectionWithTimeout(config: PoolConfig): Promise<any> {
        return new Promise(async (resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Connection timeout after ${this.config.connectionTimeout}ms`));
            }, this.config.connectionTimeout);

            try {
                const pool = await this.poolManager.getPool(config);
                clearTimeout(timeout);
                resolve(pool);
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    /**
     * Calcula el delay para el siguiente intento usando backoff exponencial
     */
    private calculateDelay(attempt: number): number {
        const delay = this.config.initialDelay * Math.pow(this.config.backoffFactor, attempt - 1);
        return Math.min(delay, this.config.maxDelay);
    }

    /**
     * Obtiene o crea el estado de reconexión para un pool
     */
    private getOrCreateState(poolKey: string) {
        if (!this.reconnectStates.has(poolKey)) {
            this.reconnectStates.set(poolKey, {
                attempts: [],
                currentDelay: this.config.initialDelay,
                isReconnecting: false,
                circuitBreakerState: CircuitBreakerState.closed,
                consecutiveFailures: 0,
                lastSuccessTime: new Date()
            });
        }
        return this.reconnectStates.get(poolKey)!;
    }

    /**
     * Resetea el estado de reconexión después de una conexión exitosa
     */
    private resetReconnectState(poolKey: string): void {
        const state = this.getOrCreateState(poolKey);
        state.attempts = [];
        state.currentDelay = this.config.initialDelay;
        state.isReconnecting = false;
        state.consecutiveFailures = 0;
        state.lastSuccessTime = new Date();

        // Cerrar circuit breaker si estaba abierto
        if (state.circuitBreakerState !== CircuitBreakerState.closed) {
            this.closeCircuitBreaker(poolKey);
        }
    }

    /**
     * Verifica si el circuit breaker está abierto
     */
    private isCircuitBreakerOpen(poolKey: string): boolean {
        if (!this.config.enableCircuitBreaker) {
            return false;
        }

        const state = this.getOrCreateState(poolKey);

        if (state.circuitBreakerState === CircuitBreakerState.open) {
            // Verificar si ha pasado el tiempo de cooldown
            if (state.circuitBreakerOpenTime) {
                const elapsed = Date.now() - state.circuitBreakerOpenTime.getTime();
                if (elapsed >= this.config.circuitBreakerCooldown) {
                    // Pasar a half-open para probar la conexión
                    state.circuitBreakerState = CircuitBreakerState.halfOpen;
                    Logger.info(`Circuit breaker for ${poolKey} moved to HALF_OPEN state`);
                    return false;
                }
                return true;
            }
        }

        return false;
    }

    /**
     * Abre el circuit breaker
     */
    private openCircuitBreaker(poolKey: string): void {
        const state = this.getOrCreateState(poolKey);
        state.circuitBreakerState = CircuitBreakerState.open;
        state.circuitBreakerOpenTime = new Date();

        Logger.warn(`Circuit breaker OPENED for ${poolKey} after ${state.consecutiveFailures} consecutive failures`);

        this.emitEvent({
            type: 'circuit-breaker-open',
            poolKey
        });
    }

    /**
     * Cierra el circuit breaker
     */
    private closeCircuitBreaker(poolKey: string): void {
        const state = this.getOrCreateState(poolKey);
        state.circuitBreakerState = CircuitBreakerState.closed;
        state.circuitBreakerOpenTime = undefined;

        Logger.info(`Circuit breaker CLOSED for ${poolKey}`);

        this.emitEvent({
            type: 'circuit-breaker-closed',
            poolKey
        });
    }

    /**
     * Genera una clave única para el pool
     */
    private generatePoolKey(config: PoolConfig): string {
        const server = config.server || 'localhost';
        const database = config.database || 'master';
        const user = config.user || 'integrated';
        const poolName = config.poolName || 'default';

        return `${poolName}_${server}_${database}_${user}`.replace(/[^a-zA-Z0-9_]/g, '_');
    }

    /**
     * Función de utilidad para sleep
     */
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Obtiene estadísticas de reconexión para un pool específico
     */
    getReconnectStats(poolKey: string): {
        totalAttempts: number;
        lastAttempt?: Date;
        consecutiveFailures: number;
        circuitBreakerState: string;
        lastSuccessTime: Date;
        isReconnecting: boolean;
    } | null {
        const state = this.reconnectStates.get(poolKey);
        if (!state) {
            return null;
        }

        return {
            totalAttempts: state.attempts.length,
            lastAttempt: state.attempts[state.attempts.length - 1]?.timestamp,
            consecutiveFailures: state.consecutiveFailures,
            circuitBreakerState: state.circuitBreakerState,
            lastSuccessTime: state.lastSuccessTime,
            isReconnecting: state.isReconnecting
        };
    }

    /**
     * Obtiene estadísticas completas de reconexión
     */
    getAllReconnectStats(): { [poolKey: string]: ReturnType<AutoReconnectManager['getReconnectStats']> } {
        const stats: { [poolKey: string]: ReturnType<AutoReconnectManager['getReconnectStats']> } = {};

        for (const poolKey of this.reconnectStates.keys()) {
            stats[poolKey] = this.getReconnectStats(poolKey);
        }

        return stats;
    }

    /**
     * Limpia el estado de reconexión para pools que ya no existen
     */
    cleanupOldStates(): void {
        const activePoolKeys = this.poolManager.getActivePoolKeys();
        const reconnectKeys = Array.from(this.reconnectStates.keys());

        for (const key of reconnectKeys) {
            if (!activePoolKeys.includes(key)) {
                this.reconnectStates.delete(key);
                Logger.info(`Cleaned up reconnect state for inactive pool: ${key}`);
            }
        }
    }

    /**
     * Fuerza el cierre del circuit breaker para un pool específico
     */
    forceCloseCircuitBreaker(poolKey: string): void {
        this.closeCircuitBreaker(poolKey);
    }

    /**
     * Actualiza la configuración de reconexión
     */
    updateConfig(newConfig: Partial<ReconnectConfig>): void {
        this.config = { ...this.config, ...newConfig };
        Logger.info('Auto-reconnect configuration updated', this.config);
    }

    /**
     * Disposes de la instancia singleton
     */
    static dispose(): void {
        if (AutoReconnectManager.instance) {
            AutoReconnectManager.instance.reconnectStates.clear();
            AutoReconnectManager.instance.eventCallbacks.clear();
            AutoReconnectManager.instance = undefined as any;
        }
    }
}