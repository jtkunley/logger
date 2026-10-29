export type LoggerLevel = 'error' | 'warn' | 'info' | 'debug';

export interface LoggerOptions {
    level?: LoggerLevel;
}

export type Data = Record<string, unknown>;

export interface RootLogger {
    child(module: string, action: string): ChildLogger;
    level(level: LoggerLevel): void;
}

export interface ChildLogger {
    debug(message: string, data: Data): void;
    info(message: string, data: Data): void;
    warn(message: string, data: Data): void;
    error(message: string, error: Error, data: Data): void;
}
