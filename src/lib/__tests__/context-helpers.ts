import { configureContext } from '../context';
import type { LogContext } from '../types';

const configuredKeys = new Set<string>();

/** `configureContext`, remembering the keys so `clearContext` can remove them. */
export function setContext(context: LogContext): void {
    for (const key of Object.keys(context)) {
        configuredKeys.add(key);
    }
    configureContext(context);
}

/** Removes every key set through `setContext`, since context is shared module state. */
export function clearContext(): void {
    configureContext(Object.fromEntries([...configuredKeys].map((key) => [key, undefined])));
    configuredKeys.clear();
}
