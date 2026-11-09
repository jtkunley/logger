# @jtkunley/logger

[![CI](https://github.com/jtkunley/logger/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/logger/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](package.json)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

Structured JSON logging for Node.js services, on top of [Pino](https://getpino.io). Every line carries the **service, module and action** that wrote it, **context such as a request ID is resolved per entry**, payloads are **bounded so a huge or circular object can't break a log line**, and a **failed transport falls back to stderr** instead of losing logs silently.

## Contents

- [Design decisions](#design-decisions)
- [Install](#install)
- [Usage](#usage)
  - [Context](#context)
  - [Transports](#transports)
  - [Flushing on shutdown](#flushing-on-shutdown)
- [Log entries](#log-entries)
- [API](#api)
- [Development](#development)
- [License](#license)

## Design decisions

- **Every line says where it came from.** A root logger names the service; a child names the module and action. Callers pass a message and a `data` object, and nothing else ends up at the top level of the entry.
- **Context is resolved, not stored.** `configureContext` takes values or functions. Functions run for each entry, so a request ID from an `AsyncLocalStorage` is current on every line. The logger never creates a context store of its own.
- **Suppressed entries cost nothing.** Below the root's level, data is not read and context functions are not called.
- **Payloads are bounded, inputs untouched.** `data`, context values and errors are copied with limits on depth and breadth, cycles marked and BigInts turned into strings. A value that throws while being read becomes `[Unserializable]` rather than an exception in the caller.
- **A failed transport is reported, not hidden.** The first transport error writes one diagnostic to stderr, and once the transport is destroyed, entries go to stderr too.
- **Shutdown can't hang.** `flush()` never rejects and gives up after 10 seconds.
- **Tested the way it runs.** Unit tests hold coverage at 100%, enforced in CI. Component tests build the package as published, install it beside the real Pino, and check stdout, stderr and log files from separate processes.

## Install

```bash
npm i @jtkunley/logger
```

Requires Node.js 22 or later.

## Usage

```ts
import { logger } from '@jtkunley/logger';

const root = logger.init('orders', { level: 'info' });
const log = root.child('checkout', 'submit');

log.info('order placed', { orderId: 42 });
log.debug('basket contents', { items }); // suppressed at info

try {
  await charge(order);
} catch (err) {
  log.error('charge failed', err, { orderId: 42 }); // err is unknown; no cast needed
}

root.level('debug'); // applies to existing children too
```

`data` is required, so every call site decides what it logs; pass `{}` when there is nothing to add. Messages are logged as they are, without `%s` substitution.

### Context

Fields configured with `configureContext` are added to the top level of every entry, from every root and child:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { logger } from '@jtkunley/logger';

const storage = new AsyncLocalStorage<{ requestId: string }>();

logger.configureContext({
  region: process.env.REGION, // a value
  requestId: () => storage.getStore()?.requestId, // a function, called for each entry
});
```

- A function that returns `undefined` or throws leaves its field out of that entry.
- Later calls merge: a new key is added, an existing key is replaced, and a key set to `undefined` is removed.
- `0`, `false`, `''` and `null` are kept.
- Keys that would clash with the standard fields (`level`, `time`, `pid`, `hostname`, `service`, `module`, `action`, `msg`, `data`, `err`) are ignored.

### Transports

Entries always go to stdout. `transports` adds outputs, run in Pino's worker thread:

```ts
const root = logger.init('orders', {
  level: 'debug',
  transports: [
    { target: 'pino/file', options: { destination: '/var/log/orders.log' } },
    { target: 'pino/file', options: { destination: '/var/log/orders-errors.log' }, level: 'error' },
  ],
});
```

Any Pino transport target works, and its `options` are passed through. A transport without a `level` receives everything the root emits; one with a `level` receives only entries at or above it, and can't receive anything the root suppresses.

If a transport fails, the first error writes one diagnostic line to stderr:

```json
{"level":50,"time":1767225600000,"service":"orders","msg":"Log transport failed; writing logs to stderr","err":{"type":"Error","message":"…","stack":"…"}}
```

Once the transport stream is destroyed, later entries are written to stderr. Entries already buffered in the failed transport are not replayed, and the transport is not restarted.

### Flushing on shutdown

```ts
process.on('SIGTERM', async () => {
  await root.flush();
  process.exit(0);
});
```

`flush()` resolves when the transport has flushed, after 10 seconds without an answer, or at once if the transport has already failed. It never rejects, and does not say which of these happened.

## Log entries

```json
{"level":30,"time":1767225600000,"service":"orders","pid":4242,"hostname":"web-1","module":"checkout","action":"submit","requestId":"r-1","msg":"order placed","data":{"orderId":42}}
```

| Field | Value |
|-------|-------|
| `level` | `20` debug, `30` info, `40` warn, `50` error |
| `time` | Milliseconds since the epoch |
| `service` | The `init` argument |
| `pid`, `hostname` | The process and host |
| `module`, `action` | The `child` arguments |
| `msg` | The message, as given |
| `data` | The `data` argument, bounded |
| `err` | Error entries only; left out when the error is `undefined` |

Context fields sit beside these at the top level.

`err` uses Pino's error serializer: an `Error` becomes `type`, `message` and `stack`, with its cause chain in both (`oops: root cause`, `caused by: Error: root cause`) and its enumerable properties kept. Anything else, such as a string or plain object, is logged as it is.

### Bounded values

`data`, each context value and `err` are copied under these rules:

| Input | Logged as |
|-------|-----------|
| An object or array 10 or more levels deep, counting the value itself as 1 | `[Object]` or `[Array]` |
| An array of more than 100 items | The first 100, then `... N items not stringified` |
| An object with more than 100 keys | The first 100, plus a `"..."` key: `N items not stringified` |
| A reference back to an ancestor | `[Circular]` (an object shared by two branches appears in both) |
| A BigInt | Its decimal string |
| An object with `toJSON`, such as a `Date` | The `toJSON` result, bounded |
| A value that throws while being read | `[Unserializable]`, replacing the whole value |

Strings are not truncated, and there is no limit on a line's total size beyond these rules. Getters and `toJSON` methods are called, with any side effects they have.

## API

### `logger.init(service, options?)`

Returns a `RootLogger`. Each call creates a new root with its own service name, level and outputs; context is shared by all of them. `init` and `configureContext` are also exported on their own.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `level` | `LogLevel` | `'info'` | The minimum level emitted. |
| `transports` | `TransportOptions[]` | `[]` | Outputs in addition to stdout. |

`TransportOptions` is `{ target: string; options?: Record<string, unknown>; level?: LogLevel }`, and `LogLevel` is `'debug' | 'info' | 'warn' | 'error'`.

### `logger.configureContext(context)`

Merges `context`, a `Record<string, unknown>`, into the fields added to every entry. See [Context](#context).

### `RootLogger`

| Method | Description |
|--------|-------------|
| `child(module, action)` | Returns a `ChildLogger`. |
| `level(level)` | Changes the minimum level, for existing children too. |
| `flush()` | Returns a `Promise<void>`; see [Flushing on shutdown](#flushing-on-shutdown). |

### `ChildLogger`

`debug(message, data)`, `info(message, data)`, `warn(message, data)` and `error(message, error, data)`, where `data` is a `Record<string, unknown>` and `error` is `unknown`. They return nothing.

## Development

```bash
npm install
npm run check           # typecheck, lint, formatting and all tests
npm run test:unit       # unit tests, next to the source in src/
npm run test:component  # component tests in test/component/
npm run test:coverage   # all tests, failing below 100% coverage
npm run format          # format with Prettier
npm run build           # compile the publishable package into dist/
```

```
src/
  index.ts                 the package entry point: logger, init, configureContext and types
  lib/
    logger.ts              init, root and child loggers, transport fallback and flush
    context.ts             configureContext and per-entry resolution
    bound.ts               depth, breadth, cycle and BigInt bounding
    types.ts               the public types
    __tests__/             unit tests, against a fake Pino transport
test/component/            behaviour tests against the built package and real Pino transports
```

`logger-acceptance-criteria.md` lists the behaviour this package implements, criterion by criterion.

### Publishing

`main`, `types` and `exports` in package.json point at built output. `npm run build` compiles it into `dist/src/` and copies `package.json`, this README, the changelog and the license into `dist/`, which is the directory to publish:

```bash
npm run build && npm publish ./dist
```

Publishing from the repository root is refused, since it would ship the TypeScript sources.

## License

[MIT](LICENSE)
