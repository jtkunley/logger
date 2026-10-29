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
        configureContext({ tier: 'test', region: 'us-west-2' });
        expect(transform()).toEqual(
            expect.objectContaining({ tier: 'test', region: 'us-west-2' }),
        );
    });

    it('should invoke resolvers on every entry', () => {
        let n = 0;
        configureContext({ requestNumber: () => ++n });
        expect(transform()).toEqual(
            expect.objectContaining({ requestNumber: 1 }),
        );
        expect(transform()).toEqual(
            expect.objectContaining({ requestNumber: 2 }),
        );
    });

    it('should omit values that resolve to undefined', () => {
        configureContext({ correlationId: () => undefined });
        expect(transform()).not.toHaveProperty('correlationId');
    });

    it('should treat a throwing resolver as unset so logging never crashes', () => {
        configureContext({
            organizationId: () => {
                throw new Error('no request context');
            },
        });
        expect(transform()).not.toHaveProperty('organizationId');
    });

    it('should never overwrite fields already on the entry', () => {
        configureContext({ message: 'clobbered', level: 'error' });
        expect(transform()).toEqual({ level: 'info', message: 'my message' });
    });

    it('should merge successive calls rather than replacing the whole context', () => {
        configureContext({ organizationId: 'org-123' });
        configureContext({ correlationId: () => 'corr-456' });
        expect(transform()).toEqual(
            expect.objectContaining({
                organizationId: 'org-123',
                correlationId: 'corr-456',
            }),
        );
    });

    it('should let a later call override a previously configured value', () => {
        configureContext({ organizationId: 'org-123' });
        configureContext({ organizationId: 'org-999' });
        expect(transform()).toEqual(
            expect.objectContaining({ organizationId: 'org-999' }),
        );
    });

    it('should remove a key passed explicitly as undefined', () => {
        configureContext({ organizationId: 'org-123' });
        configureContext({ organizationId: undefined });
        expect(transform()).not.toHaveProperty('organizationId');
    });
});
