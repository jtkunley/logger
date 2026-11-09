import { describe, expect, it } from 'vitest';
import * as entry from '..';
import { configureContext } from '../lib/context';
import { init } from '../lib/logger';

describe('the package entry', () => {
    it('exposes init and configureContext, also on logger', () => {
        expect(entry.init).toBe(init);
        expect(entry.configureContext).toBe(configureContext);
        expect(entry.logger).toEqual({ init, configureContext });
    });
});
