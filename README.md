# @jtkunley/logger

[![CI](https://github.com/jtkunley/logger/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/logger/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/jtkunley/logger)](./LICENSE)

Structured JSON logging for high-throughput Node services, built on [pino](https://github.com/pinojs/pino).

- **Off the main thread.** Writes run in a worker thread, so log I/O never blocks request handling.
- **Consistent shape.** Every entry has the same top-level fields, so logs from many services query the same way.
- **Context injection.** Add name/value pairs, static or resolved per entry from request-scoped storage, to every line without touching call sites.
- **Bounded serialization.** Logging a huge object can't block the request path.
- **Runtime level changes.** Turn on `debug` without a restart.
- **Never throws.** A failing context resolver is skipped, and a crashed transport falls back to stderr instead of taking the process down.

## Install

```sh
npm i @jtkunley/logger
```

Requires Node 22 or later. Ships with TypeScript types.

## Quick start

```ts
import { logger } from '@jtkunley/logger';

const rootLogger = logger.init('my-service');
const log = rootLogger.child('userController', 'create');

log.info('User created', { userId: 'user_123', plan: 'free' });
```

Output (one line, formatted here for readability):

```json
{
    "level": 30,
    "time": 1793244330581,
    "service": "my-service",
    "pid": 42799,
    "hostname": "api-7f9c",
    "module": "userController",
    "action": "create",
    "data": { "userId": "user_123", "plan": "free" },
    "msg": "User created"
}
```

This is pino's standard format, so pino tooling such as
[pino-pretty](https://github.com/pinojs/pino-pretty) works on it. `level` is pino's number
(20 debug, 30 info, 40 warn, 50 error) and `time` is epoch milliseconds.

## Usage

### Root and child loggers

Call `init` once at startup with your service name. Then create a child logger for each
logical action within a module, so every entry says where it came from:

```ts
const rootLogger = logger.init('my-service', { level: 'debug' });

const log = rootLogger.child('userController', 'create');
```

### Logging

Each method takes a message and a `data` object, which is logged under `data`:

```ts
log.debug('Validated request body', { userId });
log.info('User created', { userId });
log.warn('User created, but welcome email failed', { userId });
log.error('Failed to create user', error, { userId });
```

`error` accepts whatever was caught, so `catch (err)` needs no cast. It's logged under
`err`: an `Error` as `{ type, message, stack }` plus any extra properties, with its
`cause` chain appended to `message` and `stack`. Any other value is logged as-is.

### Injecting context

`configureContext` adds name/value pairs to every entry from every logger. Values can
be static, or functions that run on every entry. Functions are the way to log
request-scoped values without passing them to every call:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

const requestStore = new AsyncLocalStorage<{ contextValue: string }>();

logger.configureContext({
    'x-context-id-1': 'x-context-value-1',
    'x-context-id-2': () => requestStore.getStore()?.contextValue,
});
```

- Call it once at startup. Order relative to `init` doesn't matter.
- Values that are, or resolve to, `undefined` are omitted. A resolver that throws is
  treated the same way, so logging never throws.
- Keys naming built-in fields (`level`, `time`, `pid`, `hostname`, `service`, `module`,
  `action`, `msg`, `data`, `err`) are ignored, so context can't corrupt the entry shape.
- Calls **merge** rather than replace, so a library and an application can each add
  fields without clobbering each other. Pass a key as `undefined` to remove it.

### Changing the level at runtime

`level()` changes verbosity without a restart. It applies to every child logger,
including ones already created, and to transports that don't set their own level:

```ts
flags.on('change:log-level', (level) => rootLogger.level(level));
```

### Transports

Stdout is always a destination. Add any [pino transport](https://getpino.io/#/docs/transports)
alongside it, by package name or absolute path to your own module. Transports run in the
logging worker thread, so their options must be serializable:

```ts
logger.init('my-service', {
    transports: [
        { target: 'pino/file', options: { destination: '/var/log/app.log' } },
        {
            target: 'pino-loki',
            options: { host: 'http://loki:3100' },
            level: 'warn',
        },
    ],
});
```

A transport's `level` can only narrow the root level, never widen it.

### Shutting down

Entries are written asynchronously. On a normal exit, an uncaught exception, or
`process.exit()`, pending entries are flushed automatically (for up to 10 seconds).
Call `flush()` before exiting deliberately to be sure:

```ts
process.on('SIGTERM', async () => {
    await server.close();
    await rootLogger.flush();
    process.exit(0);
});
```

Entries still buffered when the process is killed (`SIGKILL`, out-of-memory) are lost.
For the strongest guarantee, ship logs from stdout with an external collector rather than
from an in-process network transport: a line on stdout survives the process crashing.

If a transport crashes, the logger writes one entry explaining why to stderr and sends
all later entries there, rather than losing them or crashing the process.

## Log size limits

Writing happens off the main thread, but turning an entry into JSON can't: every Node
logger serializes on the calling thread. So serialization is capped, and one log call
can't turn into megabytes of blocking `JSON.stringify` on the request path, which is what
happens if you log a Koa context, an axios error, or a large query result. The caps apply
to `data`, `err`, and context values.

- **Depth**: 10 levels from the root of the entry. `data` itself is level 2, so you get 8
  levels of nesting inside it. Anything deeper is logged as `"[Object]"`.
- **Breadth**: 100 keys per object and 100 items per array. The rest is logged as
  `"... N items not stringified"`.
- **Circular references** are logged as `"[Circular]"`.
- **BigInts** are logged as strings, to keep their precision.

If you see these markers, log a narrower object rather than raising the caps.

## API

| Export                                           | Description                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------- |
| `logger.init(serviceName, options?)`             | Create the root logger. Options: `level` (default `'info'`), `transports`. |
| `logger.configureContext(context)`               | Add static or resolved name/value pairs to every entry.                    |
| `RootLogger.child(module, action)`               | Create a child logger.                                                     |
| `RootLogger.level(level)`                        | Change the minimum level at runtime.                                       |
| `RootLogger.flush()`                             | Wait until every entry logged so far has been written.                     |
| `ChildLogger.debug / info / warn(message, data)` | Log at that level.                                                         |
| `ChildLogger.error(message, error, data)`        | Log a failure with the caught value.                                       |

Exported types: `LoggerLevel`, `LoggerOptions`, `TransportTarget`, `Context`,
`ContextResolver`, `Data`, `RootLogger`, `ChildLogger`. Full documentation is in the type
definitions.

## Development

```sh
npm install
npm test
npm run test:coverage  # fails below 100% coverage
npm run typecheck
npm run lint
npm run format:check   # or `npm run format` to fix
npm run build
```

## License

[MIT](./LICENSE)
