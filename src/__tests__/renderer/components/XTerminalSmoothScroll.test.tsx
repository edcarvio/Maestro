/**
 * Tests for XTerminal smooth scrolling configuration.
 *
 * Verifies:
 * - SMOOTH_SCROLL_DURATION_MS constant is exported with the expected value
 * - smoothScrollDuration is passed to the xterm.js Terminal constructor
 * - Smooth scrolling value is within a sensible range for UX
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// --- Mock xterm.js modules BEFORE importing XTerminal ---

/** Captures the options passed to the Terminal constructor */
let capturedTerminalOpts: Record<string, unknown> = {};

vi.mock('@xterm/xterm', () => {
	class MockTerminal {
		open = vi.fn();
		write = vi.fn();
		focus = vi.fn();
		clear = vi.fn();
		dispose = vi.fn();
		scrollToBottom = vi.fn();
		getSelection = vi.fn().mockReturnValue('');
		loadAddon = vi.fn();
		unicode = { activeVersion: '' };
		cols = 80;
		rows = 24;
		options: Record<string, unknown>;
		constructor(opts: Record<string, unknown>) {
			capturedTerminalOpts = { ...opts };
			this.options = { ...opts };
		}
		onData() {
			return { dispose: vi.fn() };
		}
		onTitleChange() {
			return { dispose: vi.fn() };
		}
	}
	return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => {
	class MockFitAddon {
		fit = vi.fn();
		dispose = vi.fn();
	}
	return { FitAddon: MockFitAddon };
});

vi.mock('@xterm/addon-webgl', () => {
	class MockWebglAddon {
		onContextLoss = vi.fn();
		dispose = vi.fn();
	}
	return { WebglAddon: MockWebglAddon };
});

vi.mock('@xterm/addon-web-links', () => {
	class MockWebLinksAddon {
		dispose = vi.fn();
	}
	return { WebLinksAddon: MockWebLinksAddon };
});

vi.mock('@xterm/addon-search', () => {
	class MockSearchAddon {
		findNext = vi.fn().mockReturnValue(true);
		findPrevious = vi.fn().mockReturnValue(true);
		clearDecorations = vi.fn();
		dispose = vi.fn();
	}
	return { SearchAddon: MockSearchAddon };
});

vi.mock('@xterm/addon-unicode11', () => {
	class MockUnicode11Addon {
		dispose = vi.fn();
	}
	return { Unicode11Addon: MockUnicode11Addon };
});

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

// Import after mocks are in place
import { XTerminal, SMOOTH_SCROLL_DURATION_MS } from '../../../renderer/components/XTerminal';
import type { Theme } from '../../../renderer/types';

const theme: Theme = {
	id: 'test-dark',
	name: 'Test Dark',
	mode: 'dark',
	colors: {
		background: '#1a1a2e',
		bgMain: '#16213e',
		bgSidebar: '#0f3460',
		bgActivity: '#0f3460',
		surface: '#1a1a4e',
		border: '#533483',
		textMain: '#e94560',
		textDim: '#a1a1b5',
		accent: '#e94560',
		accentForeground: '#ffffff',
		warning: '#ffc107',
		error: '#f44336',
		success: '#4caf50',
	},
};

beforeEach(() => {
	vi.clearAllMocks();
	capturedTerminalOpts = {};

	(window.maestro.process as Record<string, unknown>).onData = vi.fn(() => () => {});
	(window.maestro.process as Record<string, unknown>).onExit = vi.fn(() => () => {});

	vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 1);
	vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('XTerminal Smooth Scrolling', () => {
	describe('SMOOTH_SCROLL_DURATION_MS constant', () => {
		it('is exported and equals 125', () => {
			expect(SMOOTH_SCROLL_DURATION_MS).toBe(125);
		});

		it('is within a sensible UX range (50-300ms)', () => {
			// Below 50ms is imperceptible; above 300ms feels sluggish
			expect(SMOOTH_SCROLL_DURATION_MS).toBeGreaterThanOrEqual(50);
			expect(SMOOTH_SCROLL_DURATION_MS).toBeLessThanOrEqual(300);
		});

		it('is a positive integer', () => {
			expect(Number.isInteger(SMOOTH_SCROLL_DURATION_MS)).toBe(true);
			expect(SMOOTH_SCROLL_DURATION_MS).toBeGreaterThan(0);
		});
	});

	describe('Terminal constructor integration', () => {
		it('passes smoothScrollDuration to xterm.js Terminal', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			expect(capturedTerminalOpts.smoothScrollDuration).toBe(SMOOTH_SCROLL_DURATION_MS);
		});

		it('smoothScrollDuration is set to 125ms', () => {
			render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);

			expect(capturedTerminalOpts.smoothScrollDuration).toBe(125);
		});

		it('smoothScrollDuration coexists with other Terminal options', () => {
			render(
				<XTerminal
					sessionId="sess-1-terminal-tab-1"
					theme={theme}
					fontFamily="Menlo"
					fontSize={16}
					cursorStyle="underline"
					cursorBlink={false}
					scrollbackLines={5000}
				/>
			);

			// Verify smooth scroll is present alongside other options
			expect(capturedTerminalOpts.smoothScrollDuration).toBe(125);
			expect(capturedTerminalOpts.fontSize).toBe(16);
			expect(capturedTerminalOpts.cursorStyle).toBe('underline');
			expect(capturedTerminalOpts.cursorBlink).toBe(false);
			expect(capturedTerminalOpts.scrollback).toBe(5000);
		});

		it('smoothScrollDuration is always set (not configurable per-instance)', () => {
			// Render two terminals — both should get the same smooth scroll value
			const { unmount } = render(
				<XTerminal sessionId="sess-1-terminal-tab-1" theme={theme} fontFamily="Menlo" />
			);
			const firstOpts = { ...capturedTerminalOpts };

			unmount();

			render(
				<XTerminal sessionId="sess-2-terminal-tab-1" theme={theme} fontFamily="Courier" />
			);
			const secondOpts = { ...capturedTerminalOpts };

			expect(firstOpts.smoothScrollDuration).toBe(secondOpts.smoothScrollDuration);
			expect(firstOpts.smoothScrollDuration).toBe(SMOOTH_SCROLL_DURATION_MS);
		});
	});
});
