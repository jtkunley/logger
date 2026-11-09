# Changelog

## 1.0.1 (2026-11-09)

The first release of this implementation. Version 1.0.0 belonged to an earlier implementation that has been unpublished, and npm doesn't allow a version to be reused.

### Features

- **Logging:** `logger.init(service, options)` creates a Pino root logger writing JSON lines to stdout and any configured transports; `child(module, action)` loggers write `debug`, `info`, `warn` and `error(message, error, data)` entries, and `level()` changes the level of existing children too.
- **Context:** `logger.configureContext` adds static values and per-entry resolvers to the top level of every entry, from every root.
- **Bounded values:** `data`, context values and errors are copied with depth and breadth limits, cycle markers and BigInt strings, and a value that throws becomes `[Unserializable]`.
- **Transport failure:** the first transport error is reported once on stderr, and entries go to stderr once the transport is destroyed.
- **Flush:** `flush()` waits until every entry logged so far has been written by stdout and each transport, at most 10 seconds, and never rejects. Outputs run in this package's own worker rather than Pino's multi-target worker, which acknowledges a flush before entries are written.
