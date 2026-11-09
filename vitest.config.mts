import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        reporters: ['default'],
        coverage: {
            provider: 'v8',
            include: ['src/**/*.ts'],
            reporter: ['text', 'lcov'],
            reportsDirectory: 'coverage',
            thresholds: { 100: true },
        },
        projects: [
            {
                extends: true,
                test: { name: 'unit', include: ['src/**/*.{test,spec}.ts'] },
            },
            {
                extends: true,
                test: {
                    name: 'component',
                    include: ['test/component/**/*.component.spec.ts'],
                    globalSetup: ['test/component/globalSetup.ts'],
                    testTimeout: 15_000,
                },
            },
        ],
    },
});
