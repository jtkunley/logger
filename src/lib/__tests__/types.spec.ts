import { describe, expectTypeOf, it } from 'vitest';
import type { ChildLogger, LogLevel, RootLogger } from '../types';

describe('the public types', () => {
    it('limits levels to debug, info, warn and error', () => {
        expectTypeOf<LogLevel>().toEqualTypeOf<'debug' | 'info' | 'warn' | 'error'>();
    });

    it('takes a string message and required data, and returns nothing', () => {
        expectTypeOf<ChildLogger['info']>().toEqualTypeOf<
            (message: string, data: Record<string, unknown>) => void
        >();

        const log = {} as ChildLogger;
        // @ts-expect-error data is required
        expectTypeOf(log.info).toBeCallableWith('message');
    });

    it('accepts a caught value of any type as the error', () => {
        expectTypeOf<ChildLogger['error']>().parameter(1).toEqualTypeOf<unknown>();
    });

    it('takes string module and action names, and flushes to a Promise<void>', () => {
        expectTypeOf<RootLogger['child']>().parameters.toEqualTypeOf<[string, string]>();
        expectTypeOf<RootLogger['flush']>().returns.toEqualTypeOf<Promise<void>>();
    });
});
