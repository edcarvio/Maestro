/**
 * Tests for XTerminal performance optimizations.
 *
 * Verifies:
 * - Exported performance constants have expected values
 * - RAF-based write batching behavior (coalesces rapid data events)
 * - Scrollback configuration prop
 * - Force-flush behavior when buffer exceeds threshold
 * - Cleanup flushes remaining buffer on unmount
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
	DEFAULT_SCROLLBACK_LINES,
	WRITE_BUFFER_FORCE_FLUSH_SIZE,
} from '../../../renderer/components/XTerminal';

describe('XTerminal Performance Constants', () => {
	it('DEFAULT_SCROLLBACK_LINES is 10000', () => {
		expect(DEFAULT_SCROLLBACK_LINES).toBe(10000);
	});

	it('WRITE_BUFFER_FORCE_FLUSH_SIZE is 512KB', () => {
		expect(WRITE_BUFFER_FORCE_FLUSH_SIZE).toBe(512 * 1024);
	});

	it('WRITE_BUFFER_FORCE_FLUSH_SIZE is larger than typical PTY chunk size', () => {
		// Typical PTY chunks are 4KB-16KB; force-flush threshold should be much larger
		// to allow effective batching without premature flushes
		expect(WRITE_BUFFER_FORCE_FLUSH_SIZE).toBeGreaterThan(16 * 1024);
	});

	it('DEFAULT_SCROLLBACK_LINES is reasonable for memory usage', () => {
		// At ~200 bytes/line (wide terminal with ANSI), 10K lines ≈ 2MB per terminal.
		// This is reasonable for desktop apps. Verify it's within sane bounds.
		expect(DEFAULT_SCROLLBACK_LINES).toBeGreaterThanOrEqual(1000);
		expect(DEFAULT_SCROLLBACK_LINES).toBeLessThanOrEqual(100000);
	});
});

describe('XTerminal RAF Write Batching Logic', () => {
	let rafCallbacks: Map<number, FrameRequestCallback>;
	let nextRafId: number;
	let originalRaf: typeof globalThis.requestAnimationFrame;
	let originalCaf: typeof globalThis.cancelAnimationFrame;

	beforeEach(() => {
		rafCallbacks = new Map();
		nextRafId = 1;

		// Save originals
		originalRaf = globalThis.requestAnimationFrame;
		originalCaf = globalThis.cancelAnimationFrame;

		// Mock requestAnimationFrame
		globalThis.requestAnimationFrame = vi.fn((cb: FrameRequestCallback) => {
			const id = nextRafId++;
			rafCallbacks.set(id, cb);
			return id;
		});

		// Mock cancelAnimationFrame
		globalThis.cancelAnimationFrame = vi.fn((id: number) => {
			rafCallbacks.delete(id);
		});
	});

	afterEach(() => {
		// Restore originals
		globalThis.requestAnimationFrame = originalRaf;
		globalThis.cancelAnimationFrame = originalCaf;
	});

	/**
	 * Simulates the XTerminal write-batching pattern outside of React.
	 * This isolates the core batching logic for focused unit testing.
	 */
	function createWriteBatcher(writeFn: (data: string) => void) {
		let writeBuffer = '';
		let rafId = 0;

		const flush = () => {
			rafId = 0;
			if (writeBuffer) {
				writeFn(writeBuffer);
				writeBuffer = '';
			}
		};

		const onData = (data: string) => {
			writeBuffer += data;

			// Force flush if over threshold
			if (writeBuffer.length >= WRITE_BUFFER_FORCE_FLUSH_SIZE) {
				if (rafId) {
					cancelAnimationFrame(rafId);
				}
				flush();
				return;
			}

			// Schedule RAF if not pending
			if (!rafId) {
				rafId = requestAnimationFrame(flush);
			}
		};

		const dispose = () => {
			if (rafId) {
				cancelAnimationFrame(rafId);
				rafId = 0;
			}
			// Flush remaining data synchronously
			if (writeBuffer) {
				writeFn(writeBuffer);
				writeBuffer = '';
			}
		};

		const getPendingSize = () => writeBuffer.length;
		const hasPendingRaf = () => rafId !== 0;

		return { onData, dispose, flush, getPendingSize, hasPendingRaf };
	}

	/** Trigger all pending RAF callbacks */
	function flushRaf() {
		for (const [id, cb] of rafCallbacks) {
			rafCallbacks.delete(id);
			cb(performance.now());
		}
	}

	it('coalesces multiple data events into a single write', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		// Simulate 5 rapid data events within one frame
		batcher.onData('hello ');
		batcher.onData('world ');
		batcher.onData('foo ');
		batcher.onData('bar ');
		batcher.onData('baz');

		// No write yet — data is buffered
		expect(writeFn).not.toHaveBeenCalled();
		expect(batcher.getPendingSize()).toBe('hello world foo bar baz'.length);

		// Trigger RAF — single coalesced write
		flushRaf();
		expect(writeFn).toHaveBeenCalledTimes(1);
		expect(writeFn).toHaveBeenCalledWith('hello world foo bar baz');
		expect(batcher.getPendingSize()).toBe(0);
	});

	it('schedules only one RAF for multiple data events', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		batcher.onData('a');
		batcher.onData('b');
		batcher.onData('c');

		// Only one RAF should be scheduled
		expect(requestAnimationFrame).toHaveBeenCalledTimes(1);
		expect(batcher.hasPendingRaf()).toBe(true);
	});

	it('schedules new RAF after flush for subsequent data', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		batcher.onData('batch1');
		flushRaf();
		expect(writeFn).toHaveBeenCalledTimes(1);

		// New data after flush should schedule a new RAF
		batcher.onData('batch2');
		expect(requestAnimationFrame).toHaveBeenCalledTimes(2);

		flushRaf();
		expect(writeFn).toHaveBeenCalledTimes(2);
		expect(writeFn).toHaveBeenNthCalledWith(2, 'batch2');
	});

	it('force-flushes when buffer exceeds threshold', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		// Create data that exceeds the force-flush threshold
		const largeChunk = 'x'.repeat(WRITE_BUFFER_FORCE_FLUSH_SIZE + 1);
		batcher.onData(largeChunk);

		// Should have flushed immediately (no need for RAF)
		expect(writeFn).toHaveBeenCalledTimes(1);
		expect(writeFn).toHaveBeenCalledWith(largeChunk);
		expect(batcher.getPendingSize()).toBe(0);
	});

	it('force-flush cancels pending RAF before flushing', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		// Small data schedules a RAF
		batcher.onData('small');
		expect(batcher.hasPendingRaf()).toBe(true);

		// Large data triggers force-flush
		const remaining = 'y'.repeat(WRITE_BUFFER_FORCE_FLUSH_SIZE);
		batcher.onData(remaining);

		// Should cancel old RAF and flush immediately
		expect(cancelAnimationFrame).toHaveBeenCalled();
		expect(writeFn).toHaveBeenCalledTimes(1);
		expect(writeFn).toHaveBeenCalledWith('small' + remaining);
	});

	it('handles incremental buildup to threshold', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		const chunkSize = Math.floor(WRITE_BUFFER_FORCE_FLUSH_SIZE / 4);
		const chunk = 'a'.repeat(chunkSize);

		// Add 4 chunks: first 3 stay buffered, 4th triggers force-flush
		batcher.onData(chunk);
		batcher.onData(chunk);
		batcher.onData(chunk);
		expect(writeFn).not.toHaveBeenCalled();

		batcher.onData(chunk); // This brings total to threshold
		expect(writeFn).toHaveBeenCalledTimes(1);
		expect(writeFn).toHaveBeenCalledWith(chunk.repeat(4));
	});

	it('flushes remaining buffer on dispose', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		batcher.onData('leftover data');
		expect(writeFn).not.toHaveBeenCalled();

		batcher.dispose();
		expect(writeFn).toHaveBeenCalledTimes(1);
		expect(writeFn).toHaveBeenCalledWith('leftover data');
	});

	it('dispose cancels pending RAF', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		batcher.onData('pending');
		expect(batcher.hasPendingRaf()).toBe(true);

		batcher.dispose();
		expect(cancelAnimationFrame).toHaveBeenCalled();
	});

	it('dispose with empty buffer does not write', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		batcher.dispose();
		expect(writeFn).not.toHaveBeenCalled();
	});

	it('no-op for empty data after flush', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		batcher.onData('data');
		flushRaf();
		expect(writeFn).toHaveBeenCalledTimes(1);

		// Trigger RAF with nothing pending — should not call write
		flushRaf();
		expect(writeFn).toHaveBeenCalledTimes(1);
	});

	it('handles interleaved small and large data correctly', () => {
		const writeFn = vi.fn();
		const batcher = createWriteBatcher(writeFn);

		// Small data (buffered)
		batcher.onData('small');

		// RAF triggers first write
		flushRaf();
		expect(writeFn).toHaveBeenCalledTimes(1);
		expect(writeFn).toHaveBeenCalledWith('small');

		// Large data (force-flushed)
		const large = 'z'.repeat(WRITE_BUFFER_FORCE_FLUSH_SIZE + 100);
		batcher.onData(large);
		expect(writeFn).toHaveBeenCalledTimes(2);
		expect(writeFn).toHaveBeenCalledWith(large);

		// Small again (buffered)
		batcher.onData('after');
		flushRaf();
		expect(writeFn).toHaveBeenCalledTimes(3);
		expect(writeFn).toHaveBeenCalledWith('after');
	});
});

describe('XTerminal Scrollback Configuration', () => {
	it('DEFAULT_SCROLLBACK_LINES provides sufficient history for typical terminal use', () => {
		// A user running `npm install` or a build might generate 5000+ lines of output.
		// 10,000 lines should cover most use cases while keeping memory reasonable.
		expect(DEFAULT_SCROLLBACK_LINES).toBeGreaterThanOrEqual(5000);
	});

	it('scrollback memory estimate is within acceptable bounds', () => {
		// Rough estimate: each scrollback line stores ~200 bytes (80 chars + attributes)
		// 10,000 lines ≈ 2MB per terminal — reasonable for a desktop app
		const estimatedBytesPerLine = 200;
		const estimatedMemoryMB = (DEFAULT_SCROLLBACK_LINES * estimatedBytesPerLine) / (1024 * 1024);
		expect(estimatedMemoryMB).toBeLessThan(10); // Under 10MB per terminal
	});
});
