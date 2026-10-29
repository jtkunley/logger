import { EventEmitter } from 'node:events';
import { vi } from 'vitest';

import { withFallback, type TransportStream } from '../destination';

class FakeTransport extends EventEmitter implements TransportStream {
    destroyed = false;
    write = vi.fn(() => true);
    flush = vi.fn((callback: (err?: Error | null) => void) => {
        callback(null);
    });

    crash() {
        this.destroyed = true;
        this.emit('error', new Error('the worker thread exited'));
    }
}

function setup() {
    const transport = new FakeTransport();
    const fallback = { write: vi.fn() };
    const destination = withFallback(transport, fallback, 'SampleServiceName');
    return { transport, fallback, destination };
}

describe('withFallback', () => {
    it('should write to the transport while it is running', () => {
        const { transport, fallback, destination } = setup();
        destination.write('line\n');
        expect(transport.write).toHaveBeenCalledWith('line\n');
        expect(fallback.write).not.toHaveBeenCalled();
    });

    it('should explain the failure once, then write to the fallback', () => {
        const { transport, fallback, destination } = setup();
        transport.crash();
        transport.emit('error', new Error('the worker has exited'));
        destination.write('line\n');

        expect(transport.write).not.toHaveBeenCalled();
        expect(fallback.write).toHaveBeenCalledTimes(2);
        const warning = JSON.parse(
            fallback.write.mock.calls[0]?.[0] as string,
        ) as Record<string, unknown>;
        expect(warning).toEqual({
            level: 50,
            time: expect.any(Number),
            service: 'SampleServiceName',
            msg: 'Log transport failed; writing logs to stderr',
            err: {
                type: 'Error',
                message: 'the worker thread exited',
                stack: expect.any(String),
            },
        });
        expect(fallback.write).toHaveBeenLastCalledWith('line\n');
    });

    it('should flush through the transport while it is running', () => {
        const { transport, destination } = setup();
        const callback = vi.fn();
        destination.flush(callback);
        expect(transport.flush).toHaveBeenCalled();
        expect(callback).toHaveBeenCalled();
    });

    it('should complete a flush immediately once the transport has failed', () => {
        const { transport, destination } = setup();
        transport.crash();
        const callback = vi.fn();
        destination.flush(callback);
        expect(transport.flush).not.toHaveBeenCalled();
        expect(callback).toHaveBeenCalled();
    });
});
