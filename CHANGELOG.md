# Changelog

## 1.0.0 (2026-10-28)

Initial release. Requires Node 22 or later.

- Built on pino 10, writing pino's standard JSON format with `service`, `module`, `action`, `pid`, and `hostname`.
- Writes run in a worker thread; stdout is always a destination, and `transports` adds any pino transport.
- `RootLogger.flush` waits for pending entries before a deliberate exit.
- A crashed transport falls back to stderr instead of losing entries or crashing the process.
- `configureContext` injects static or per-entry resolved name/value pairs into every entry.
- Serialization of `data`, `err`, and context capped at 10 levels deep and 100 items per object or array.
- `error` accepts any caught value; `Error`s log their type, message, stack, extra properties, and cause chain.
- Runtime level changes via `RootLogger.level`, applied to child loggers and transports without their own level.
