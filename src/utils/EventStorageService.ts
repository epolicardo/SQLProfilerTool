import { EventRegistry, StoredEvent } from './EventRegistry';
import { Logger } from './Logger';

export interface EventStorageConfig {
    maxEvents?: number;
    autoPersistIntervalMs?: number;
    sessionId: string;
}

/**
 * EventStorageService - Orquesta el almacenamiento de eventos
 * 
 * Responsabilidades:
 * - Gestionar el EventRegistry
 * - Manejar persistencia automática a disco
 * - Proporcionar interfaz limpia para SqlProfilerManager
 */
export class EventStorageService {
    private registry: EventRegistry;
    private autoPersistInterval: NodeJS.Timeout | undefined;
    private autoPersistIntervalMs: number = 10000; // 10 seconds
    private isDirty: boolean = false;

    constructor(config: EventStorageConfig) {
        this.registry = new EventRegistry(config.sessionId, config.maxEvents || 2000);
        this.autoPersistIntervalMs = config.autoPersistIntervalMs || 10000;
        
        // Start auto-persist timer
        this.startAutoPersist();
    }

    /**
     * Añade un evento al almacén
     */
    public addEvent(event: StoredEvent): boolean {
        const added = this.registry.addEvent(event);
        if (added) {
            this.isDirty = true;
            Logger.debug(`Event added to storage: ${event.id}`);
        }
        return added;
    }

    /**
     * Añade múltiples eventos
     */
    public addEvents(events: StoredEvent[]): number {
        const added = this.registry.addEvents(events);
        if (added > 0) {
            this.isDirty = true;
            Logger.debug(`${added} events added to storage`);
        }
        return added;
    }

    /**
     * Obtiene todos los eventos
     */
    public getAllEvents(): StoredEvent[] {
        return this.registry.getAllEvents();
    }

    /**
     * Obtiene los últimos N eventos
     */
    public getLastNEvents(n: number): StoredEvent[] {
        return this.registry.getLastNEvents(n);
    }

    /**
     * Obtiene un evento específico
     */
    public getEvent(id: string): StoredEvent | undefined {
        return this.registry.getEvent(id);
    }

    /**
     * Busca eventos por statement
     */
    public searchByStatement(query: string): StoredEvent[] {
        return this.registry.searchByStatement(query);
    }

    /**
     * Limpia todo el almacén
     */
    public clear(): void {
        this.registry.clear();
        this.isDirty = false;
        Logger.debug('Event storage cleared');
    }

    /**
     * Obtiene estadísticas
     */
    public getStats() {
        return this.registry.getStats();
    }

    /**
     * Persiste manualmente a disco
     */
    public persistToDisk(): void {
        this.registry.saveToDisk();
        this.isDirty = false;
    }

    /**
     * Limpia recursos
     */
    public dispose(): void {
        this.stopAutoPersist();
        if (this.isDirty) {
            this.persistToDisk();
        }
    }

    /**
     * Inicia el auto-persist
     */
    private startAutoPersist(): void {
        this.autoPersistInterval = setInterval(() => {
            if (this.isDirty) {
                this.persistToDisk();
                Logger.debug('Auto-persisted event registry to disk');
            }
        }, this.autoPersistIntervalMs);
    }

    /**
     * Detiene el auto-persist
     */
    private stopAutoPersist(): void {
        if (this.autoPersistInterval) {
            clearInterval(this.autoPersistInterval);
            this.autoPersistInterval = undefined;
        }
    }
}
