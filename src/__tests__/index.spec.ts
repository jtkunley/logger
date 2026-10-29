import * as pkg from '../index';

describe('public API', () => {
    it('should expose only init and configureContext under logger', () => {
        expect(Object.keys(pkg)).toEqual(['logger']);
        expect(Object.keys(pkg.logger).sort()).toEqual([
            'configureContext',
            'init',
        ]);
    });
});
