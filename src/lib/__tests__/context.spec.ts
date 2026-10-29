import {
    configureContext,
    resolveContext,
    _resetContextForTesting,
} from '../context';

describe('context', () => {
    afterEach(() => {
        _resetContextForTesting();
    });

    it('should be empty when nothing is configured', () => {
        expect(resolveContext()).toEqual({});
    });

    it('should resolve static values', () => {
        configureContext({
            'x-context-id-1': 'x-context-value-1',
            'x-context-id-2': 'x-context-value-2',
        });
        expect(resolveContext()).toEqual({
            'x-context-id-1': 'x-context-value-1',
            'x-context-id-2': 'x-context-value-2',
        });
    });

    it('should invoke resolvers on every entry', () => {
        let n = 0;
        configureContext({ 'x-context-id-1': () => ++n });
        expect(resolveContext()).toEqual({ 'x-context-id-1': 1 });
        expect(resolveContext()).toEqual({ 'x-context-id-1': 2 });
    });

    it.each([0, false, '', null])(
        'should keep the falsy value %j, static or resolved',
        (value) => {
            configureContext({
                'x-context-id-1': value,
                'x-context-id-2': () => value,
            });
            expect(resolveContext()).toEqual({
                'x-context-id-1': value,
                'x-context-id-2': value,
            });
        },
    );

    it('should omit values that resolve to undefined', () => {
        configureContext({ 'x-context-id-1': () => undefined });
        expect(resolveContext()).toEqual({});
    });

    it('should treat a throwing resolver as unset so logging never crashes', () => {
        configureContext({
            'x-context-id-1': () => {
                throw new Error('no request context');
            },
        });
        expect(resolveContext()).toEqual({});
    });

    it('should ignore keys that name built-in fields', () => {
        configureContext({
            msg: 'clobbered',
            level: 'clobbered',
            'x-context-id-1': 'x-context-value-1',
        });
        expect(resolveContext()).toEqual({
            'x-context-id-1': 'x-context-value-1',
        });
    });

    it('should merge successive calls rather than replacing the whole context', () => {
        configureContext({ 'x-context-id-1': 'x-context-value-1' });
        configureContext({ 'x-context-id-2': () => 'x-context-value-2' });
        expect(resolveContext()).toEqual({
            'x-context-id-1': 'x-context-value-1',
            'x-context-id-2': 'x-context-value-2',
        });
    });

    it('should let a later call override a previously configured value', () => {
        configureContext({ 'x-context-id-1': 'x-context-value-1' });
        configureContext({ 'x-context-id-1': 'x-context-value-2' });
        expect(resolveContext()).toEqual({
            'x-context-id-1': 'x-context-value-2',
        });
    });

    it('should remove a key passed explicitly as undefined', () => {
        configureContext({ 'x-context-id-1': 'x-context-value-1' });
        configureContext({ 'x-context-id-1': undefined });
        expect(resolveContext()).toEqual({});
    });
});
