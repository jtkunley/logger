# @jtkunley/logger

[![CI](https://github.com/jtkunley/logger/actions/workflows/ci.yml/badge.svg)](https://github.com/jtkunley/logger/actions/workflows/ci.yml)
[![license](https://img.shields.io/github/license/jtkunley/logger)](./LICENSE)

Structured JSON logging for Node services, built on [winston](https://github.com/winstonjs/winston).

- **Consistent shape.** Every entry has the same top-level fields, so logs from many services query the same way.
- **Context injection.** Add name/value pairs, static or resolved per entry from request-scoped storage, to every line without touching call sites.
- **Bounded serialization.** Logging a huge object can't block the request path.
- **Runtime level changes.** Turn on `debug` without a restart.
- **Never throws.** A failing context resolver is skipped instead of crashing the caller.

## Install

```sh
npm install github:jtkunley/logger
```

Not yet published to the npm registry; this installs from GitHub and builds on install.
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
    "service": "my-service",
    "module": "userController",
    "action": "create",
    "level": "info",
    "message": "User created",
    "data": { "userId": "user_123", "plan": "free" },
    "timestamp": "2026-10-29T01:44:14.677Z",
    "pid": 42799,
    "hostname": "api-7f9c"
}
```

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

`error` accepts whatever was caught, so `catch (err)` needs no cast. For an `Error`, its
message and stack are added at the root of the entry as `error` and `stack`; any other
value is logged as `error` as-is.

### Injecting context

`configureContext` adds name/value pairs to every entry from every logger. Values can
be static, or functions that run on every entry. Functions are the way to log
request-scoped values such as a correlation ID without passing them to every call:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';

const requestStore = new AsyncLocalStorage<{ correlationId: string }>();

logger.configureContext({
    tier: process.env.TIER,
    correlationId: () => requestStore.getStore()?.correlationId,
});
```

- Call it once at startup. Order relative to `init` doesn't matter.
- Values that are, or resolve to, `undefined` are omitted. A resolver that throws is
  treated the same way, so logging never throws.
- Context never overwrites built-in fields such as `message`, `level`, or `service`.
- Calls **merge** rather than replace, so a library and an application can each add
  fields without clobbering each other. Pass a key as `undefined` to remove it.

### Changing the level at runtime

`level()` changes verbosity without a restart. It applies to every child logger,
including ones already created, and to custom transports that don't set their own level:

```ts
flags.on('change:log-level', (level) => rootLogger.level(level));
```

### Custom transports

The console is always a destination. Add any winston transport alongside it:

```ts
import { transports } from 'winston';

logger.init('my-service', {
    customTransports: { file: new transports.File({ filename: 'app.log' }) },
});
```

## Log size limits

Serialization is capped so that one log call can't turn into megabytes of blocking
`JSON.stringify` on the request path, which is what happens if you log a Koa context,
an axios error, or a large query result.

- **Depth**: 10 levels from the root of the entry. `data` itself is level 2, so you get 8
  levels of nesting inside it. Anything deeper is logged as `"[Object]"`.
- **Breadth**: 100 keys per object and 100 items per array. The rest is logged as
  `"... N items not stringified"`.
- **Circular references** are logged as `"[Circular]"`.

If you see these markers, log a narrower object rather than raising the caps.

## API

| Export                                           | Description                                                                      |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| `logger.init(serviceName, options?)`             | Create the root logger. Options: `level` (default `'info'`), `customTransports`. |
| `logger.configureContext(context)`               | Add static or resolved name/value pairs to every entry.                          |
| `RootLogger.child(module, action)`               | Create a child logger.                                                           |
| `RootLogger.level(level)`                        | Change the minimum level at runtime.                                             |
| `ChildLogger.debug / info / warn(message, data)` | Log at that level.                                                               |
| `ChildLogger.error(message, error, data)`        | Log an error with its message and stack.                                         |
| `ChildLogger.getVendorInstance()`                | Access the underlying winston logger.                                            |

Exported types: `LoggerLevel`, `LoggerOptions`, `Context`, `ContextResolver`, `Data`,
`RootLogger`, `ChildLogger`. Full documentation is in the type definitions.

## Development

```sh
npm install
npm test
npm run typecheck
npm run lint
npm run format:check   # or `npm run format` to fix
npm run build
```

## License

[MIT](./LICENSE)
