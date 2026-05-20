/**
 * Performance utility functions for SQL Profiler Tool
 */

/**
 * Creates a debounced function that delays invoking func until after wait milliseconds
 * have elapsed since the last time the debounced function was invoked.
 * 
 * @param func The function to debounce
 * @param wait The number of milliseconds to delay
 * @returns A new debounced function
 */
export function debounce<T extends (...args: any[]) => void>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | undefined;
    
    return function executedFunction(...args: Parameters<T>) {
        const later = () => {
            timeout = undefined;
            func(...args);
        };
        
        if (timeout) {
            clearTimeout(timeout);
        }
        timeout = setTimeout(later, wait);
    };
}

/**
 * Creates a throttled function that only invokes func at most once per every wait milliseconds.
 * 
 * @param func The function to throttle
 * @param wait The number of milliseconds to throttle invocations to
 * @returns A new throttled function
 */
export function throttle<T extends (...args: any[]) => void>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let inThrottle: boolean;
    
    return function executedFunction(...args: Parameters<T>) {
        if (!inThrottle) {
            func(...args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, wait);
        }
    };
}

/**
 * Cleanup utility for Maps with timeout-based entries
 * Removes entries older than the specified timeout
 * 
 * @param map The map to cleanup
 * @param timeoutMs The timeout in milliseconds
 * @param getTimestamp Function to extract timestamp from map entry
 */
export function cleanupTimedMap<K, V>(
    map: Map<K, V>,
    timeoutMs: number,
    getTimestamp: (value: V) => number
): void {
    const now = Date.now();
    const keysToDelete: K[] = [];
    
    for (const [key, value] of map.entries()) {
        if (now - getTimestamp(value) > timeoutMs) {
            keysToDelete.push(key);
        }
    }
    
    for (const key of keysToDelete) {
        map.delete(key);
    }
}
