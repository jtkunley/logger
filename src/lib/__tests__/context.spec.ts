import { afterEach, describe, expect, it } from 'vitest';
import { resolveContext } from '../context';
import { clearContext, setContext as configureContext } from './context-helpers';

afterEach(clearContext);

describe('configureContext', () => {
    it('adds nothing until something is configured', () => {
        expect(resolveContext()).toEqual({});
    });

    it('keeps static values, including falsy ones', () => {
        configureContext({ zero: 0, no: false, empty: '', nothing: null, name: 'svc' });

        expect(resolveContext()).toEqual({
            zero: 0,
            no: false,
            empty: '',
            nothing: null,
            name: 'svc',
        });
    });

    it('leaves out a static undefined', () => {
        configureContext({ missing: undefined });

        expect(resolveContext()).not.toHaveProperty('missing');
    });

    it('calls a resolver for every entry', () => {
        let count = 0;
        configureContext({ count: () => ++count });

        expect(resolveContext()).toEqual({ count: 1 });
        expect(resolveContext()).toEqual({ count: 2 });
    });

    it('leaves out a field whose resolver returns undefined', () => {
        configureContext({ requestId: () => undefined });

        expect(resolveContext()).not.toHaveProperty('requestId');
    });

    it('leaves out a field whose resolver throws, without throwing', () => {
        configureContext({
            broken: () => {
                throw new Error('resolver');
            },
            fine: 'kept',
        });

        expect(resolveContext()).toEqual({ fine: 'kept' });
    });

    it('merges keys across calls', () => {
        configureContext({ a: 1 });
        configureContext({ b: 2 });

        expect(resolveContext()).toEqual({ a: 1, b: 2 });
    });

    it('replaces a value or resolver configured earlier', () => {
        configureContext({ a: 1, b: () => 'old' });
        configureContext({ a: () => 'resolved', b: 'static' });

        expect(resolveContext()).toEqual({ a: 'resolved', b: 'static' });
    });

    it('removes a key set to undefined', () => {
        configureContext({ a: 1, b: 2 });
        configureContext({ a: undefined });

        expect(resolveContext()).toEqual({ b: 2 });
    });

    it('ignores reserved keys', () => {
        const reserved = ['level', 'time', 'pid', 'hostname', 'service', 'module', 'action'];
        const more = ['msg', 'data', 'err'];
        configureContext(Object.fromEntries([...reserved, ...more].map((key) => [key, 'x'])));

        expect(resolveContext()).toEqual({});
    });

    it('bounds each value', () => {
        configureContext({ big: 1n, list: () => Array.from({ length: 101 }, () => 0) });

        const resolved = resolveContext();

        expect(resolved['big']).toBe('1');
        expect((resolved['list'] as unknown[]).at(-1)).toBe('... 1 item not stringified');
    });

    it('logs a value that cannot be read as [Unserializable]', () => {
        configureContext({
            user: () => ({
                get id(): never {
                    throw new Error('getter');
                },
            }),
        });

        expect(resolveContext()).toEqual({ user: '[Unserializable]' });
    });

    it('keeps a __proto__ key as an ordinary field', () => {
        configureContext(JSON.parse('{"__proto__":"value"}'));

        const resolved = resolveContext();

        expect(Object.getPrototypeOf(resolved)).toBe(Object.prototype);
        expect(Object.keys(resolved)).toEqual(['__proto__']);
    });
});
