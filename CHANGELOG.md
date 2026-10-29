# Changelog

## 1.0.0

Initial public release.

- Structured JSON entries with `service`, `module`, `action`, `timestamp`, `pid`, and `hostname`.
- `configureContext` injects static or per-entry resolved name/value pairs into every entry.
- Serialization capped at 10 levels deep and 100 items per object or array.
- Runtime level changes via `RootLogger.level`, applied to child loggers and level-less custom transports.
