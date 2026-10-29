import {
    configureContext,
    contextFormat,
    _resetContextForTesting,
} from '../context';

function transform(info: Record<string, unknown> = {}) {
    return contextFormat().transform({
        level: 'info',
        message: 'my message',
        ...info,
    });
}

describe('context', () => {
    afterEach(() => {
        _resetContextForTesting();
    });

    it('should leave the entry untouched when nothing is configured', () => {
        expect(transform({ data: { key: 'value' } })).toEqual({
            level: 'info',
            message: 'my message',
            data: { key: 'value' },
        });
    });

    it('should inject static values', () => {
        configureContext({
            'x-context-id-1': 'x-context-value-1',
            'x-context-id-2': 'x-context-value-2',
        });
        expect(transform()).toEqual(
            expect.objectContaining({
                'x-context-id-1': 'x-context-value-1',
                'x-context-id-2': 'x-context-value-2',
            }),
        );
    });

    it('should invoke resolvers on every entry', () => {
        let n = 0;
        configureContext({ 'x-context-id-1': () => ++n });
        expect(transform()).toEqual(
            expect.objectContaining({ 'x-context-id-1': 1 }),
        );
        expect(transform()).toEqual(
            expect.objectContaining({ 'x-context-id-1': 2 }),
        );
    });

    it.each([0, false, '', null])(
        'should inject the falsy value %j, static or resolved',
        (value) => {
            configureContext({
                'x-context-id-1': value,
                'x-context-id-2': () => value,
            });
            expect(transform()).toEqual(
                expect.objectContaining({
                    'x-context-id-1': value,
                    'x-context-id-2': value,
                }),
            );
        },
    );

    it('should omit values that resolve to undefined', () => {
        configureContext({ 'x-context-id-1': () => undefined });
        expect(transform()).not.toHaveProperty('x-context-id-1');
    });

    it('should treat a throwing resolver as unset so logging never crashes', () => {
        configureContext({
            'x-context-id-1': () => {
                throw new Error('no request context');
            },
        });
        expect(transform()).not.toHaveProperty('x-context-id-1');
    });

    it('should never overwrite fields already on the entry', () => {
        configureContext({ message: 'clobbered', level: 'error' });
        expect(transform()).toEqual({ level: 'info', message: 'my message' });
    });

    it('should merge successive calls rather than replacing the whole context', () => {
        configureContext({ 'x-context-id-1': 'x-context-value-1' });
        configureContext({ 'x-context-id-2': () => 'x-context-value-2' });
        expect(transform()).toEqual(
            expect.objectContaining({
                'x-context-id-1': 'x-context-value-1',
                'x-context-id-2': 'x-context-value-2',
            }),
        );
    });

    it('should let a later call override a previously configured value', () => {
        configureContext({ 'x-context-id-1': 'x-context-value-1' });
        configureContext({ 'x-context-id-1': 'x-context-value-2' });
        expect(transform()).toEqual(
            expect.objectContaining({ 'x-context-id-1': 'x-context-value-2' }),
        );
    });

    it('should remove a key passed explicitly as undefined', () => {
        configureContext({ 'x-context-id-1': 'x-context-value-1' });
        configureContext({ 'x-context-id-1': undefined });
        expect(transform()).not.toHaveProperty('x-context-id-1');
    });
});
