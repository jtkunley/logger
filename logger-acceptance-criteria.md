# Logger — Functional Acceptance Criteria

Derived from the executable source and existing tests of the previous implementation of this package, at commit `958e33a0562f55066dc4d6e2042e93762e2ce14b`. README content and project configuration are excluded. These criteria describe current functionality, including its observable limits; they do not propose improvements.

**Implementation assumption:** Pino.

## Public logging contract

- **AC-001 — Initialization:** `logger.init(serviceName, options?)` returns a root logger. Omitting options is supported. The default minimum log level is `info`.
- **AC-002 — Initialization options:** Options accept a `level` and a list of additional `transports`. A transport accepts a `target` string, optional `options` object, and optional `level`.
- **AC-003 — Root operations:** A root logger provides `child(module, action)`, `level(level)`, and `flush()`.
- **AC-004 — Child operations:** A child logger provides `debug(message, data)`, `info(message, data)`, `warn(message, data)`, and `error(message, error, data)`. These logging methods return no value.
- **AC-005 — Argument types:** Messages, service names, module names, and action names are strings. `data` is a required `Record<string, unknown>` argument. The error argument accepts `unknown`, allowing a caught value without a cast.
- **AC-006 — Supported levels:** The supported level type consists of `debug`, `info`, `warn`, and `error`.
- **AC-007 — Repeated initialization:** Calling `init` again creates another root logger; it does not return an enforced singleton. Roots have their own service names, levels, and destinations. Configured context is shared across roots.

## Log entry shape

- **AC-008 — Output format:** Each emitted ordinary log entry is a Pino JSON record terminated by a newline.
- **AC-009 — Standard fields:** An ordinary entry includes `level`, `time`, `service`, `pid`, `hostname`, `module`, `action`, `msg`, and `data`, when called with the declared argument types.
- **AC-010 — Severity values:** Emitted levels are numeric: `debug = 20`, `info = 30`, `warn = 40`, and `error = 50`.
- **AC-011 — Timestamp:** `time` is a numeric epoch timestamp in milliseconds.
- **AC-012 — Origin fields:** `service` matches the root's initialization argument. `module` and `action` match the child logger's arguments. `pid` identifies the running process, and `hostname` identifies its host.
- **AC-013 — Structured payload:** Caller-supplied data is placed under `data`; its properties are not promoted into the entry's top-level fields.
- **AC-014 — Literal messages:** Messages are preserved literally. For example, `info('100% done for %s', {})` emits `msg: '100% done for %s'` without placeholder substitution.

## Severity filtering and runtime changes

- **AC-015 — Error threshold:** At root level `error`, only error entries are emitted.
- **AC-016 — Warning threshold:** At root level `warn`, warning and error entries are emitted.
- **AC-017 — Information threshold:** At root level `info`, information, warning, and error entries are emitted.
- **AC-018 — Debug threshold:** At root level `debug`, all four supported severities are emitted.
- **AC-019 — Existing children:** Changing a root's level changes the filtering of children that already exist. A debug entry suppressed at `info` is emitted after changing to `debug`; a warning is suppressed after changing to `error`.
- **AC-020 — Suppressed payloads:** For suppressed `debug`, `info`, and `warn` calls, data is not traversed or serialized. A throwing getter on that data is not accessed.
- **AC-021 — Suppressed context:** Context resolver functions are not invoked for entries suppressed by the root's level.

## Configured context

- **AC-022 — Configuration operation:** `logger.configureContext(context)` accepts a string-keyed record of arbitrary values. A function-valued entry acts as a zero-argument resolver returning `unknown`.
- **AC-023 — Initial state:** With no configured context, no context fields are added.
- **AC-024 — Placement:** Configured context fields appear at the top level of ordinary emitted entries.
- **AC-025 — Shared reach:** Context applies to all severities and all root and child loggers using the loaded library instance.
- **AC-026 — Configuration timing:** Context configured after a logger is created applies to subsequent entries from that logger. Configuration before initialization also applies.
- **AC-027 — Static values:** Non-function values are used as context values. `0`, `false`, the empty string, and `null` are retained.
- **AC-028 — Per-entry resolution:** Resolver functions run separately for each emitted entry. Changing resolver results are reflected in successive entries; results are not fixed when a logger is created.
- **AC-029 — Undefined values:** A static `undefined` value is omitted. A resolver returning `undefined` causes that field to be omitted from that entry.
- **AC-030 — Resolver failure:** A resolver that throws causes its field to be omitted, without propagating that resolver exception to the logging caller.
- **AC-031 — Merging:** Successive configuration calls merge keys. Configuring a new key preserves previously configured unrelated keys.
- **AC-032 — Replacement:** Reconfiguring an existing key replaces its previous static value or resolver for subsequent entries.
- **AC-033 — Removal:** Passing an existing key with value `undefined` removes that key from subsequently emitted context.
- **AC-034 — Reserved fields:** Context keys named `level`, `time`, `pid`, `hostname`, `service`, `module`, `action`, `msg`, `data`, or `err` are ignored. They neither overwrite nor duplicate those built-in fields.
- **AC-035 — Value bounds:** Each resolved context value receives the same bounded-value treatment described below. A value that cannot be traversed is logged as `[Unserializable]`; a resolver exception instead omits the field.
- **AC-036 — Resolver ownership:** Context functions are supplied by the caller. The logger resolves them; it does not create or manage a request-context store.

## Bounded data and context values

- **AC-037 — Scope:** The bounded-value behavior applies to the supplied `data` value, each resolved context value, and the error value after Pino's standard error serialization.
- **AC-038 — Depth boundary:** Count the supplied value as depth 1. An object at depth 10 or deeper becomes `[Object]`; an array at that depth becomes `[Array]`. Primitive values are retained even at that boundary.
- **AC-039 — Exact nesting examples:** Define `nested(n)` as `{ leaf: 'bottom' }` wrapped `n` times in an object with one property. Logging `nested(8)` as data retains `bottom` without an `[Object]` marker. Logging `nested(9)` replaces the deepest object with `[Object]` and omits `bottom`.
- **AC-040 — Array depth example:** In `nested(8)`, replace the deepest `leaf` value with `['bottom']`. Logging it produces `leaf: '[Array]'`.
- **AC-041 — Array breadth:** Arrays of up to 100 items are retained in full, subject to the other value rules. Longer arrays retain their first 100 items and append one truncation-marker string.
- **AC-042 — Array markers:** A 101-item array appends exactly `... 1 item not stringified`. A 105-item array appends exactly `... 5 items not stringified`. The count is the number of omitted original items.
- **AC-043 — Object breadth:** Objects with up to 100 own enumerable string keys retain those keys, subject to the other value rules. Wider objects retain the first 100 keys in normal JavaScript enumeration order.
- **AC-044 — Object markers:** A truncated object adds a property named `...` whose value is `1 item not stringified` or `N items not stringified`, with the correct omitted-key count. For a 101-key object named `key0` through `key100`, `key100` is absent and `data['...']` is `1 item not stringified`.
- **AC-045 — Cycles:** A reference to an object already on the current traversal ancestry becomes `[Circular]`. For `{ key: 'value', self: itself }`, the `key` value remains and `self` becomes `[Circular]`.
- **AC-046 — Shared references:** An object used in two separate branches is included in both branches when it is not an ancestor cycle. Shared identity alone does not produce `[Circular]`.
- **AC-047 — BigInts:** BigInt values become decimal strings without loss of precision. For example, `12345678901234567890n` becomes `'12345678901234567890'`.
- **AC-048 — Custom JSON values:** An object with a callable `toJSON` uses that method's result before applying the other value rules at that position. A `Date` such as `2026-01-01T00:00:00.000Z` is logged as that ISO string.
- **AC-049 — Traversal failures:** An exception while bounding a supplied value replaces that entire supplied value with `[Unserializable]`. For a throwing getter inside `data`, the resulting `data` is the marker string, and the bounding failure does not escape the logging call.
- **AC-050 — Prototype-named data:** An own data key named `__proto__`, such as one obtained from `JSON.parse`, is preserved as an ordinary serialized property.
- **AC-051 — Input preservation:** Bounding creates the output representation without replacing values in the caller's objects or arrays. Caller-provided getters and `toJSON` methods may themselves have side effects.
- **AC-052 — Limit boundaries:** The wrapper imposes no string-length cap, combined output-byte cap, or aggregate node-count budget. Depth and breadth limits must not be interpreted as those additional guarantees.

## Error entries

- **AC-053 — Error placement:** Calling `error(message, error, data)` emits severity 50, retains the ordinary message and data behavior, and includes the caught value under `err` when that value is serializable and not `undefined`.
- **AC-054 — Error objects:** A normal `Error` is represented using Pino's standard error serializer, including `type`, `message`, and `stack`. A `TypeError('oops')` has type `TypeError`, message `oops`, and a stack containing `TypeError: oops`.
- **AC-055 — Extra error properties:** Enumerable custom error properties are retained and bounded. For example, an attached `code: 'E_OOPS'` remains present, and an attached 101-item response array receives the array truncation marker.
- **AC-056 — Cause chains:** An error `new Error('oops', { cause: new Error('root cause') })` produces an error message containing `oops: root cause` and a stack containing `caused by: Error: root cause`.
- **AC-057 — Other caught values:** A caught string such as `'plain string'` remains a string under `err`. A plain object such as `{ reason: 'denied' }` remains structured under `err`, subject to bounding.
- **AC-058 — Undefined errors:** If the supplied caught value is `undefined`, `err` is omitted rather than emitted as a placeholder or `null`.
- **AC-059 — Error protection boundary:** Error handling uses Pino's standard error serialization before the bounded-value protection. These criteria do not require universal exception suppression for arbitrary hostile error objects or failing output streams.

## Destinations and transport filtering

- **AC-060 — Default output:** Initialization includes stdout as an output destination even when no extra transports are configured.
- **AC-061 — Additional outputs:** Configured transports receive eligible entries in addition to stdout. A file transport configured with a destination path writes JSON entries to that file.
- **AC-062 — Transport targets:** Transport configuration accepts Pino-compatible targets and passes through each target's options.
- **AC-063 — Background output:** Normal configured transport output uses Pino's worker transport support. Data preparation, context resolution, and JSON serialization are not required to run in that worker.
- **AC-064 — Transport default threshold:** A transport without an explicit level accepts `debug` and higher entries that pass the root's filter. This also applies to stdout.
- **AC-065 — Narrower transport thresholds:** An explicitly configured transport threshold further filters entries; it cannot restore an entry suppressed at the root. For example, an error-only transport receives errors but no debug, information, or warning entries.
- **AC-066 — Runtime filtering across outputs:** Root level changes affect entries sent to every transport, including existing transports without explicit thresholds. Explicit transport thresholds continue to apply.
- **AC-067 — Healthy output:** While the transport stream is not destroyed, ordinary entries go to that stream rather than the stderr fallback.

## Transport failure behavior

- **AC-068 — Failure diagnostic:** The first transport `error` event writes one newline-terminated JSON diagnostic to stderr. Further transport error events do not repeat that diagnostic.
- **AC-069 — Diagnostic fields:** The diagnostic contains `level: 50`, a numeric millisecond `time`, the initialized `service`, `msg: 'Log transport failed; writing logs to stderr'`, and `err` containing the reported error's `type`, `message`, and `stack`.
- **AC-070 — Diagnostic shape exception:** The failure diagnostic does not require the ordinary entry's `pid`, `hostname`, `module`, `action`, `data`, or configured context fields.
- **AC-071 — Destroyed-stream fallback:** Once the transport stream is destroyed, subsequent serialized entries go to stderr instead of being written to the destroyed stream.
- **AC-072 — Fallback condition:** The fallback routing condition is the stream's destroyed state. An error event alone is not a separate permanent routing switch while the stream remains undestroyed.
- **AC-073 — Recovery boundary:** Failure handling does not replay entries previously buffered in the failed transport and does not recreate or restart that transport.

## Flush behavior

- **AC-074 — Return contract:** `root.flush()` returns a `Promise<void>`.
- **AC-075 — Healthy completion:** With a healthy destination, the promise remains pending until its flush callback runs, unless the timeout below is reached. On callback, it resolves with no value.
- **AC-076 — Time limit:** If the destination never calls back, the flush promise resolves after 10,000 milliseconds instead of remaining pending indefinitely.
- **AC-077 — Early completion:** If the flush callback runs before the timeout, the timeout is cancelled and the promise resolves without waiting for the remaining interval.
- **AC-078 — Flush errors:** An error supplied to the transport's flush callback is not propagated as a rejection; the outer flush completes normally.
- **AC-079 — Destroyed destination:** If the transport is already destroyed, flush completes immediately without calling the failed stream's flush operation. It does not wait for stderr to drain.
- **AC-080 — Completion meaning:** A resolved flush promise does not distinguish successful callback completion from the ten-second timeout or destroyed-stream completion. It supplies no delivery-status value.
- **AC-081 — Entry persistence example:** After logging an eligible entry to configured file transports and awaiting a successful flush, reading those files yields the expected JSON entry, including service, severity, message, error value, and data.
