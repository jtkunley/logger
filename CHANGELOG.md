# Changelog

## 1.0.0 (2026-11-08)

### Features

- **Logging:** `logger.init(service, options)` creates a Pino root logger writing JSON lines to stdout and any configured transports; `child(module, action)` loggers write `debug`, `info`, `warn` and `error(message, error, data)` entries, and `level()` changes the level of existing children too.
- **Context:** `logger.configureContext` adds static values and per-entry resolvers to the top level of every entry, from every root.
- **Bounded values:** `data`, context values and errors are copied with depth and breadth limits, cycle markers and BigInt strings, and a value that throws becomes `[Unserializable]`.
- **Transport failure:** the first transport error is reported once on stderr, and entries go to stderr once the transport is destroyed.
- **Flush:** `flush()` waits for the transport, at most 10 seconds, and never rejects.
