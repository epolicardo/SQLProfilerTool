import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { Logger } from './Logger';

export interface StoredEvent {
    id: string;
    timestamp: string;
    eventName: string;
    statement: string;
    duration?: number;
    databaseName?: string;
    userName?: string;
    applicationName?: string;
    xeTimestamp?: string; // Timestamp from XE session for deduplication
    xeId?: string; // Unique ID from XE session if available
}

export interface EventRegistryStats {
    totalEvents: number;
    uniqueStatements: number;
    oldestEvent: string | null;
    newestEvent: string | null;
    fileSize: number;
    lastUpdated: string;
}

/**
 * EventRegistry - Almacén local deduplicated de eventos
 * 
 * Propósito:
 * - Mantener un registro único de eventos capturados
 * - Evitar mostrar el mismo evento múltiples veces
 * - Ser la única fuente de verdad para la UI
 * - Permitir persistencia entre sesiones
 */
export class EventRegistry {
    private events: Map<string, StoredEvent> = new Map();
    private registryFile: string;
    private maxEvents: number = 2000;
    private readonly SESSION_REGISTRY_DIR = path.join(os.tmpdir(), 'sql-profiler-registry');

    // Deduplication by multiple layers
    private statementSignatures: Map<string, string> = new Map(); // Maps statement hash -> event ID
    private xeEventIds: Set<string> = new Set(); // Track XE events we've already added

    constructor(sessionId: string, maxEvents: number = 2000) {
        this.maxEvents = maxEvents;
        this.registryFile = path.join(this.SESSION_REGISTRY_DIR, `registry-${sessionId}.json`);
        
        // Ensure directory exists
        if (!fs.existsSync(this.SESSION_REGISTRY_DIR)) {
            fs.mkdirSync(this.SESSION_REGISTRY_DIR, { recursive: true });
        }

        // Load existing registry from disk
        this.loadFromDisk();
    }

    /**
     * Añade un evento al registro
     * Retorna true si fue añadido, false si era duplicado
     */
    public addEvent(event: StoredEvent): boolean {
        // Layer 1: Check by event ID
        if (this.events.has(event.id)) {
            Logger.debug(`Event already exists: ${event.id}`);
            return false;
        }

        // Layer 2: Check by XE timestamp + statement (for XE duplicates)
        if (event.xeTimestamp && event.statement) {
            const xeKey = `${event.xeTimestamp}::${event.statement}`;
            if (this.xeEventIds.has(xeKey)) {
                Logger.debug(`XE duplicate detected: ${xeKey.substring(0, 50)}`);
                return false;
            }
            this.xeEventIds.add(xeKey);
        }

        // Layer 3: Check by statement signature (normalized)
        const signature = this.hashStatement(event.statement);
        const existingEventId = this.statementSignatures.get(signature);
        if (existingEventId && this.events.has(existingEventId)) {
            const existing = this.events.get(existingEventId)!;
            // Same statement in very short time window = likely duplicate
            if (this.isTimestampClose(existing.timestamp, event.timestamp, 5000)) {
                Logger.debug(`Duplicate by signature: ${signature}`);
                return false;
            }
        }

        // Add the event
        this.events.set(event.id, event);
        this.statementSignatures.set(signature, event.id);

        // Trim if exceeds max
        if (this.events.size > this.maxEvents) {
            this.trimOldest();
        }

        return true;
    }

    /**
     * Añade múltiples eventos y retorna cuántos fueron añadidos
     */
    public addEvents(events: StoredEvent[]): number {
        let added = 0;
        for (const event of events) {
            if (this.addEvent(event)) {
                added++;
            }
        }
        return added;
    }

    /**
     * Retorna todos los eventos ordenados por timestamp (más reciente primero)
     */
    public getAllEvents(): StoredEvent[] {
        const sorted = Array.from(this.events.values());
        sorted.sort((a, b) => {
            const timeA = new Date(a.timestamp).getTime();
            const timeB = new Date(b.timestamp).getTime();
            return timeB - timeA; // Descending
        });
        return sorted;
    }

    /**
     * Retorna los últimos N eventos
     */
    public getLastNEvents(n: number): StoredEvent[] {
        return this.getAllEvents().slice(0, n);
    }

    /**
     * Obtiene un evento por ID
     */
    public getEvent(id: string): StoredEvent | undefined {
        return this.events.get(id);
    }

    /**
     * Busca eventos por statement (substring match)
     */
    public searchByStatement(query: string): StoredEvent[] {
        const lowerQuery = query.toLowerCase();
        return this.getAllEvents().filter(e =>
            e.statement.toLowerCase().includes(lowerQuery)
        );
    }

    /**
     * Limpia todos los eventos
     */
    public clear(): void {
        this.events.clear();
        this.statementSignatures.clear();
        this.xeEventIds.clear();
        this.deleteDiskFile();
    }

    /**
     * Retorna estadísticas del registro
     */
    public getStats(): EventRegistryStats {
        const allEvents = this.getAllEvents();
        const fileSize = fs.existsSync(this.registryFile)
            ? fs.statSync(this.registryFile).size
            : 0;

        return {
            totalEvents: this.events.size,
            uniqueStatements: this.statementSignatures.size,
            oldestEvent: allEvents.length > 0 ? allEvents[allEvents.length - 1].timestamp : null,
            newestEvent: allEvents.length > 0 ? allEvents[0].timestamp : null,
            fileSize,
            lastUpdated: new Date().toISOString()
        };
    }

    /**
     * Guarda el registro en disco
     */
    public saveToDisk(): void {
        try {
            const events = Array.from(this.events.values());
            const data = {
                version: '1.0',
                timestamp: new Date().toISOString(),
                eventCount: events.length,
                events
            };

            fs.writeFileSync(this.registryFile, JSON.stringify(data, null, 2), 'utf-8');
            Logger.debug(`Registry saved to disk: ${this.registryFile} (${events.length} events)`);
        } catch (error) {
            Logger.error('Failed to save registry to disk:', error);
        }
    }

    /**
     * Carga el registro desde disco
     */
    private loadFromDisk(): void {
        try {
            if (!fs.existsSync(this.registryFile)) {
                Logger.debug(`Registry file does not exist: ${this.registryFile}`);
                return;
            }

            const content = fs.readFileSync(this.registryFile, 'utf-8');
            const data = JSON.parse(content);

            if (Array.isArray(data.events)) {
                data.events.forEach((event: StoredEvent) => {
                    this.events.set(event.id, event);
                    const sig = this.hashStatement(event.statement);
                    this.statementSignatures.set(sig, event.id);
                });
                Logger.debug(`Registry loaded from disk: ${data.events.length} events`);
            }
        } catch (error) {
            Logger.error('Failed to load registry from disk:', error);
            // Continue with empty registry
        }
    }

    /**
     * Elimina el archivo de registro
     */
    private deleteDiskFile(): void {
        try {
            if (fs.existsSync(this.registryFile)) {
                fs.unlinkSync(this.registryFile);
                Logger.debug(`Registry file deleted: ${this.registryFile}`);
            }
        } catch (error) {
            Logger.error('Failed to delete registry file:', error);
        }
    }

    /**
     * Calcula un hash normalizado de un statement
     */
    private hashStatement(statement: string): string {
        // Normalize: lowercase, trim, remove extra whitespace
        const normalized = statement
            .toLowerCase()
            .trim()
            .replace(/\s+/g, ' ')
            .substring(0, 200); // First 200 chars

        // Simple hash
        let hash = 0;
        for (let i = 0; i < normalized.length; i++) {
            const char = normalized.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return `stmt_${Math.abs(hash).toString(16)}`;
    }

    /**
     * Verifica si dos timestamps están cerca (dentro de msWindow)
     */
    private isTimestampClose(ts1: string, ts2: string, msWindow: number): boolean {
        try {
            const time1 = new Date(ts1).getTime();
            const time2 = new Date(ts2).getTime();
            return Math.abs(time1 - time2) <= msWindow;
        } catch {
            return false;
        }
    }

    /**
     * Elimina los eventos más antiguos cuando se excede el límite
     */
    private trimOldest(): void {
        const sorted = this.getAllEvents();
        const eventsToRemove = sorted.slice(this.maxEvents);

        eventsToRemove.forEach(event => {
            this.events.delete(event.id);
            const sig = this.hashStatement(event.statement);
            this.statementSignatures.delete(sig);
        });

        Logger.debug(`Registry trimmed: removed ${eventsToRemove.length} oldest events`);
    }
}
