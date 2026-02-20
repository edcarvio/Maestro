/**
 * TerminalTabBar - Tab bar for managing multiple terminal tabs.
 *
 * Simplified compared to TabBar.tsx (AI tabs):
 * - No star/unread functionality
 * - Right-click context menu with: Rename, Close, Close Others, Close to the Right
 * - Simple display names: "Terminal 1", "Terminal 2", or custom name
 * - Terminal icon color indicates state: green (exited 0), red (exited non-zero), yellow (busy)
 * - Middle-click closes tabs; double-click opens rename dialog
 */

import React, { useState, useCallback, useRef, useEffect, memo, useMemo } from 'react';
import { X, Plus, Terminal as TerminalIcon, Loader2, Edit3, ChevronsRight } from 'lucide-react';
import type { TerminalTab, Theme } from '../types';
import { getTerminalTabDisplayName } from '../utils/terminalTabHelpers';
import { formatShortcutKeys } from '../utils/shortcutFormatter';
import { useClickOutside } from '../hooks/ui/useClickOutside';

/** Duration (ms) of the CSS enter animation for new terminal tabs. */
export const TERMINAL_TAB_ENTER_MS = 150;
/** Duration (ms) of the CSS exit animation for closing terminal tabs. */
export const TERMINAL_TAB_EXIT_MS = 120;

/** Props for the TerminalTabBar component. */
interface TerminalTabBarProps {
	tabs: TerminalTab[];
	activeTabId: string;
	theme: Theme;
	onTabSelect: (tabId: string) => void;
	/** Called after close animation completes. */
	onTabClose: (tabId: string) => void;
	onNewTab: () => void;
	/** Open a rename modal/dialog for the given tab. */
	onRequestRename?: (tabId: string) => void;
	/** Called when a tab is dragged to a new position. */
	onTabReorder?: (fromIndex: number, toIndex: number) => void;
	/** Close all tabs except the specified one. */
	onCloseOtherTabs?: (tabId: string) => void;
	/** Close all tabs to the right of the specified one. */
	onCloseTabsToRight?: (tabId: string) => void;
}

interface TerminalTabItemProps {
	tab: TerminalTab;
	index: number;
	isActive: boolean;
	theme: Theme;
	canClose: boolean;
	onSelect: () => void;
	onClose: () => void;
	onMiddleClick: () => void;
	onDragStart: (e: React.DragEvent) => void;
	onDragOver: (e: React.DragEvent) => void;
	onDragEnd: () => void;
	onDrop: (e: React.DragEvent) => void;
	isDragging: boolean;
	isDragOver: boolean;
	onRename: () => void;
	onContextMenu: (e: React.MouseEvent) => void;
	isNew: boolean;
	isClosing: boolean;
}

/**
 * Get the state-based icon color for a terminal tab.
 * Green for clean exit, red for error exit, yellow for busy, inherited for idle.
 */
function getStateColor(tab: TerminalTab, theme: Theme): string | undefined {
	if (tab.state === 'exited') {
		return tab.exitCode === 0 ? theme.colors.success : theme.colors.error;
	}
	if (tab.state === 'busy') {
		return theme.colors.warning;
	}
	return undefined; // inherit from parent
}

/** A single terminal tab in the tab bar. Supports drag-and-drop reordering,
 *  middle-click close, double-click rename, and right-click context menu. */
const TerminalTabItem = memo(function TerminalTabItem({
	tab,
	index,
	isActive,
	theme,
	canClose,
	onSelect,
	onClose,
	onMiddleClick,
	onDragStart,
	onDragOver,
	onDragEnd,
	onDrop,
	isDragging,
	isDragOver,
	onRename,
	onContextMenu,
	isNew,
	isClosing,
}: TerminalTabItemProps) {
	const [isHovered, setIsHovered] = useState(false);
	const displayName = useMemo(() => getTerminalTabDisplayName(tab, index), [tab.name, index]);
	const stateColor = useMemo(() => getStateColor(tab, theme), [tab.state, tab.exitCode, theme]);
	const isExited = tab.state === 'exited';
	const tooltip = useMemo(() => `${tab.shellType} - ${tab.cwd}`, [tab.shellType, tab.cwd]);

	// Hover background varies by theme mode
	const hoverBgColor = theme.mode === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.08)';

	const tabStyle = useMemo(
		() =>
			({
				borderTopLeftRadius: '6px',
				borderTopRightRadius: '6px',
				backgroundColor: isActive ? theme.colors.bgMain : isHovered ? hoverBgColor : 'transparent',
				borderTop: isActive ? `1px solid ${theme.colors.border}` : '1px solid transparent',
				borderLeft: isActive ? `1px solid ${theme.colors.border}` : '1px solid transparent',
				borderRight: isActive ? `1px solid ${theme.colors.border}` : '1px solid transparent',
				borderBottom: isActive ? `1px solid ${theme.colors.bgMain}` : '1px solid transparent',
				marginBottom: isActive ? '-1px' : '0',
				zIndex: isActive ? 1 : 0,
				'--tw-ring-color': isDragOver ? theme.colors.accent : 'transparent',
			}) as React.CSSProperties,
		[isActive, isHovered, isDragOver, theme.colors.bgMain, theme.colors.border, theme.colors.accent, hoverBgColor]
	);

	return (
		<div
			draggable
			title={tooltip}
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDragEnd={onDragEnd}
			onDrop={onDrop}
			onClick={onSelect}
			onContextMenu={onContextMenu}
			onMouseDown={(e) => {
				if (e.button === 1) {
					e.preventDefault();
					onMiddleClick();
				}
			}}
			onDoubleClick={onRename}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			className={`
				relative flex items-center gap-1.5 px-3 py-1.5 cursor-pointer
				transition-all duration-150 select-none shrink-0
				${isDragging ? 'opacity-50' : ''}
				${isDragOver ? 'ring-2 ring-inset' : ''}
				${isNew ? 'terminal-tab-enter' : ''}
				${isClosing ? 'terminal-tab-exit' : ''}
			`}
			style={tabStyle}
		>
			{/* Terminal icon with state indicator / spinner while PTY spawns */}
			{tab.pid === 0 && tab.state === 'idle' ? (
				<Loader2
					className="w-3.5 h-3.5 flex-shrink-0 animate-spin"
					style={{ color: isActive ? theme.colors.accent : theme.colors.textDim }}
					data-testid="loader-icon"
				/>
			) : (
				<TerminalIcon
					className="w-3.5 h-3.5 flex-shrink-0"
					style={{ color: stateColor || (isActive ? theme.colors.textMain : theme.colors.textDim) }}
				/>
			)}

			{/* Tab name */}
			<span
				className="text-xs font-medium truncate max-w-[150px]"
				style={{ color: isActive ? theme.colors.textMain : theme.colors.textDim }}
			>
				{displayName}
			</span>

			{/* Exit code indicator for non-zero exits */}
			{isExited && tab.exitCode !== 0 && tab.exitCode != null && (
				<span
					className="text-[10px] opacity-70"
					title={`Exit code: ${tab.exitCode}`}
					style={{ color: theme.colors.error }}
				>
					({tab.exitCode})
				</span>
			)}

			{/* Close button */}
			{canClose && (isHovered || isActive) && (
				<button
					onClick={(e) => {
						e.stopPropagation();
						onClose();
					}}
					className="p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
					title="Close terminal"
				>
					<X className="w-3 h-3" style={{ color: theme.colors.textDim }} />
				</button>
			)}
		</div>
	);
});

/**
 * Context menu for terminal tabs.
 * Follows the same pattern as SessionContextMenu in SessionList.tsx:
 * fixed positioning, useClickOutside, Escape dismissal, viewport clamping.
 */
interface TerminalTabContextMenuProps {
	x: number;
	y: number;
	tabId: string;
	tabIndex: number;
	totalTabs: number;
	theme: Theme;
	onRename: () => void;
	onClose: () => void;
	onCloseOthers: () => void;
	onCloseToRight: () => void;
	onDismiss: () => void;
}

function TerminalTabContextMenu({
	x,
	y,
	tabIndex,
	totalTabs,
	theme,
	onRename,
	onClose,
	onCloseOthers,
	onCloseToRight,
	onDismiss,
}: TerminalTabContextMenuProps) {
	const menuRef = useRef<HTMLDivElement>(null);

	// Close on click outside
	useClickOutside(menuRef, onDismiss);

	// Close on Escape
	const onDismissRef = useRef(onDismiss);
	onDismissRef.current = onDismiss;
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				onDismissRef.current();
			}
		};
		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, []);

	// Adjust position to stay within viewport
	const adjustedPosition = {
		left: Math.min(x, window.innerWidth - 200),
		top: Math.min(y, window.innerHeight - 160),
	};

	const canClose = totalTabs > 1;
	const isLastTab = tabIndex === totalTabs - 1;

	const menuItemClass = 'w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 transition-colors flex items-center gap-2';
	const disabledClass = 'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 opacity-40 cursor-default';

	return (
		<div
			ref={menuRef}
			className="fixed z-50 py-1 rounded-md shadow-xl border"
			style={{
				left: adjustedPosition.left,
				top: adjustedPosition.top,
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
				minWidth: '160px',
			}}
			data-testid="terminal-tab-context-menu"
		>
			{/* Rename */}
			<button
				onClick={() => { onRename(); onDismiss(); }}
				className={menuItemClass}
				style={{ color: theme.colors.textMain }}
			>
				<Edit3 className="w-3.5 h-3.5" />
				Rename
			</button>

			{/* Divider */}
			<div className="my-1 border-t" style={{ borderColor: theme.colors.border }} />

			{/* Close */}
			<button
				onClick={() => { onClose(); onDismiss(); }}
				className={canClose ? menuItemClass : disabledClass}
				style={{ color: theme.colors.textMain }}
				disabled={!canClose}
			>
				<X className="w-3.5 h-3.5" />
				Close
			</button>

			{/* Close Others */}
			<button
				onClick={() => { onCloseOthers(); onDismiss(); }}
				className={canClose ? menuItemClass : disabledClass}
				style={{ color: theme.colors.textMain }}
				disabled={!canClose}
			>
				<X className="w-3.5 h-3.5" />
				Close Others
			</button>

			{/* Close to the Right */}
			<button
				onClick={() => { onCloseToRight(); onDismiss(); }}
				className={!isLastTab ? menuItemClass : disabledClass}
				style={{ color: theme.colors.textMain }}
				disabled={isLastTab}
			>
				<ChevronsRight className="w-3.5 h-3.5" />
				Close to the Right
			</button>
		</div>
	);
}

export const TerminalTabBar = memo(function TerminalTabBar({
	tabs,
	activeTabId,
	theme,
	onTabSelect,
	onTabClose,
	onNewTab,
	onRequestRename,
	onTabReorder,
	onCloseOtherTabs,
	onCloseTabsToRight,
}: TerminalTabBarProps) {
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
	const [contextMenu, setContextMenu] = useState<{
		x: number;
		y: number;
		tabId: string;
		tabIndex: number;
	} | null>(null);

	// --- Tab transition animation state ---
	// `knownTabIdsRef` tracks all tab IDs we've seen so far. On each render,
	// IDs present in `tabs` but absent from this set are treated as newly added
	// (and get the CSS enter animation). Seeded from initial tabs to avoid
	// animating the first render.
	const knownTabIdsRef = useRef<Set<string>>(new Set(tabs.map(t => t.id)));
	// Tab IDs currently playing the enter animation (cleared after TERMINAL_TAB_ENTER_MS).
	const [animatingNewIds, setAnimatingNewIds] = useState<Set<string>>(new Set());
	// Tab IDs currently playing the exit animation. The real close callback fires
	// only after TERMINAL_TAB_EXIT_MS so the fade-out is visible.
	const [closingTabIds, setClosingTabIds] = useState<Set<string>>(new Set());

	// Detect new tabs added after initial render
	useEffect(() => {
		const currentIds = tabs.map(t => t.id);
		const newIds: string[] = [];

		for (const id of currentIds) {
			if (!knownTabIdsRef.current.has(id)) {
				newIds.push(id);
				knownTabIdsRef.current.add(id);
			}
		}

		// Clean up IDs no longer in the tabs array
		for (const id of knownTabIdsRef.current) {
			if (!currentIds.includes(id)) {
				knownTabIdsRef.current.delete(id);
			}
		}

		if (newIds.length > 0) {
			setAnimatingNewIds(prev => {
				const next = new Set(prev);
				for (const id of newIds) next.add(id);
				return next;
			});

			const timer = setTimeout(() => {
				setAnimatingNewIds(prev => {
					const next = new Set(prev);
					for (const id of newIds) next.delete(id);
					return next;
				});
			}, TERMINAL_TAB_ENTER_MS);

			return () => clearTimeout(timer);
		}
	}, [tabs]);

	/**
	 * Start the exit animation for a single tab, then invoke `onTabClose`
	 * after `TERMINAL_TAB_EXIT_MS`. Guards against double-close by checking
	 * `closingTabIds`. If the tab is still in its enter animation, swaps
	 * the enter class for exit immediately.
	 */
	const handleAnimatedClose = useCallback((tabId: string) => {
		if (closingTabIds.has(tabId)) return;
		// Remove from enter animation set if still running
		setAnimatingNewIds(prev => {
			const next = new Set(prev);
			next.delete(tabId);
			return next;
		});
		setClosingTabIds(prev => new Set([...prev, tabId]));
		setTimeout(() => {
			setClosingTabIds(prev => {
				const next = new Set(prev);
				next.delete(tabId);
				return next;
			});
			onTabClose(tabId);
		}, TERMINAL_TAB_EXIT_MS);
	}, [closingTabIds, onTabClose]);

	/** Animate-close all tabs except `keepTabId`, then invoke `onCloseOtherTabs`. */
	const handleAnimatedCloseOthers = useCallback((keepTabId: string) => {
		const idsToClose = tabs.filter(t => t.id !== keepTabId && !closingTabIds.has(t.id)).map(t => t.id);
		if (idsToClose.length === 0) return;
		setClosingTabIds(prev => new Set([...prev, ...idsToClose]));
		setTimeout(() => {
			setClosingTabIds(new Set());
			onCloseOtherTabs?.(keepTabId);
		}, TERMINAL_TAB_EXIT_MS);
	}, [tabs, closingTabIds, onCloseOtherTabs]);

	/** Animate-close all tabs to the right of `tabId`, then invoke `onCloseTabsToRight`. */
	const handleAnimatedCloseToRight = useCallback((tabId: string) => {
		const tabIndex = tabs.findIndex(t => t.id === tabId);
		if (tabIndex === -1) return;
		const idsToClose = tabs.slice(tabIndex + 1).filter(t => !closingTabIds.has(t.id)).map(t => t.id);
		if (idsToClose.length === 0) return;
		setClosingTabIds(prev => new Set([...prev, ...idsToClose]));
		setTimeout(() => {
			setClosingTabIds(new Set());
			onCloseTabsToRight?.(tabId);
		}, TERMINAL_TAB_EXIT_MS);
	}, [tabs, closingTabIds, onCloseTabsToRight]);

	const handleDragStart = useCallback(
		(index: number) => (e: React.DragEvent) => {
			setDraggingIndex(index);
			e.dataTransfer.effectAllowed = 'move';
			e.dataTransfer.setData('text/plain', String(index));
		},
		[]
	);

	const handleDragOver = useCallback(
		(index: number) => (e: React.DragEvent) => {
			e.preventDefault();
			e.dataTransfer.dropEffect = 'move';
			setDragOverIndex(index);
		},
		[]
	);

	const handleDragEnd = useCallback(() => {
		setDraggingIndex(null);
		setDragOverIndex(null);
	}, []);

	const handleDrop = useCallback(
		(toIndex: number) => (e: React.DragEvent) => {
			e.preventDefault();
			const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
			if (!isNaN(fromIndex) && fromIndex !== toIndex && onTabReorder) {
				onTabReorder(fromIndex, toIndex);
			}
			setDraggingIndex(null);
			setDragOverIndex(null);
		},
		[onTabReorder]
	);

	const canClose = tabs.length > 1;

	const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string, tabIndex: number) => {
		e.preventDefault();
		setContextMenu({ x: e.clientX, y: e.clientY, tabId, tabIndex });
	}, []);

	const dismissContextMenu = useCallback(() => {
		setContextMenu(null);
	}, []);

	return (
		<div
			className="flex items-end gap-0.5 pt-2 border-b overflow-x-auto overflow-y-hidden no-scrollbar"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
			}}
		>
			{/* Tabs */}
			{tabs.map((tab, index) => {
				const isActive = tab.id === activeTabId;
				const prevTab = index > 0 ? tabs[index - 1] : null;
				const isPrevActive = prevTab?.id === activeTabId;
				const showSeparator = index > 0 && !isActive && !isPrevActive;

				return (
					<React.Fragment key={tab.id}>
						{showSeparator && (
							<div
								className="w-px h-4 self-center shrink-0"
								style={{ backgroundColor: theme.colors.border }}
							/>
						)}
						<TerminalTabItem
							tab={tab}
							index={index}
							isActive={isActive}
							theme={theme}
							canClose={canClose}
							onSelect={() => onTabSelect(tab.id)}
							onClose={() => handleAnimatedClose(tab.id)}
							onMiddleClick={() => canClose && handleAnimatedClose(tab.id)}
							onDragStart={handleDragStart(index)}
							onDragOver={handleDragOver(index)}
							onDragEnd={handleDragEnd}
							onDrop={handleDrop(index)}
							isDragging={draggingIndex === index}
							isDragOver={dragOverIndex === index}
							onRename={() => onRequestRename?.(tab.id)}
							onContextMenu={(e) => handleContextMenu(e, tab.id, index)}
							isNew={animatingNewIds.has(tab.id)}
							isClosing={closingTabIds.has(tab.id)}
						/>
					</React.Fragment>
				);
			})}

			{/* New tab button */}
			<div className="flex items-center shrink-0 pl-2 pr-2 self-stretch">
				<button
					onClick={onNewTab}
					className="flex items-center justify-center w-6 h-6 rounded hover:bg-white/10 transition-colors"
					style={{ color: theme.colors.textDim }}
					title={`New terminal (${formatShortcutKeys(['Ctrl', 'Shift', '`'])})`}
				>
					<Plus className="w-4 h-4" />
				</button>
			</div>

			{/* Context menu */}
			{contextMenu && (
				<TerminalTabContextMenu
					x={contextMenu.x}
					y={contextMenu.y}
					tabId={contextMenu.tabId}
					tabIndex={contextMenu.tabIndex}
					totalTabs={tabs.length}
					theme={theme}
					onRename={() => onRequestRename?.(contextMenu.tabId)}
					onClose={() => handleAnimatedClose(contextMenu.tabId)}
					onCloseOthers={() => handleAnimatedCloseOthers(contextMenu.tabId)}
					onCloseToRight={() => handleAnimatedCloseToRight(contextMenu.tabId)}
					onDismiss={dismissContextMenu}
				/>
			)}
		</div>
	);
});
