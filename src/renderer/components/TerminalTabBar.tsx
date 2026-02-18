/**
 * TerminalTabBar - Standalone tab bar for managing multiple terminal tabs.
 *
 * Used in terminal mode (inputMode === 'terminal') as a dedicated tab bar.
 * Simpler than the unified TabBar:
 * - No star/unread functionality
 * - No context menu (merge, send to agent, etc.)
 * - Simpler display names (Terminal 1, Terminal 2, or custom name)
 * - Shows status dot indicating tab state
 * - Shows exit code if terminal exited with error
 */

import React, { useState, useRef, useCallback, memo, useMemo } from 'react';
import { X, Plus, TerminalSquare } from 'lucide-react';
import type { TerminalTab, Theme } from '../types';
import { getTerminalTabDisplayName } from '../utils/terminalTabHelpers';
import { formatShortcutKeys } from '../utils/shortcutFormatter';

interface TerminalTabBarProps {
	tabs: TerminalTab[];
	activeTabId: string;
	theme: Theme;
	onTabSelect: (tabId: string) => void;
	onTabClose: (tabId: string) => void;
	onNewTab: () => void;
	onRequestRename?: (tabId: string) => void;
	onTabReorder?: (fromIndex: number, toIndex: number) => void;
}

interface SingleTerminalTabProps {
	tab: TerminalTab;
	index: number;
	isActive: boolean;
	theme: Theme;
	canClose: boolean;
	onSelect: (tabId: string) => void;
	onClose: (tabId: string) => void;
	onDragStart: (tabId: string, e: React.DragEvent) => void;
	onDragOver: (tabId: string, e: React.DragEvent) => void;
	onDragEnd: () => void;
	onDrop: (tabId: string, e: React.DragEvent) => void;
	isDragging: boolean;
	isDragOver: boolean;
	onRename: (tabId: string) => void;
}

/**
 * Single terminal tab component.
 * Matches the visual style of TerminalTabComponent in TabBar.tsx
 * (browser-tab style with rounded top corners).
 */
const SingleTerminalTab = memo(function SingleTerminalTab({
	tab,
	index,
	isActive,
	theme,
	canClose,
	onSelect,
	onClose,
	onDragStart,
	onDragOver,
	onDragEnd,
	onDrop,
	isDragging,
	isDragOver,
	onRename,
}: SingleTerminalTabProps) {
	const [isHovered, setIsHovered] = useState(false);

	const displayName = getTerminalTabDisplayName(tab, index);
	const isExited = tab.state === 'exited';

	const handleClick = useCallback(() => {
		onSelect(tab.id);
	}, [onSelect, tab.id]);

	const handleClose = useCallback(
		(e: React.MouseEvent) => {
			e.stopPropagation();
			onClose(tab.id);
		},
		[onClose, tab.id]
	);

	const handleMouseDown = useCallback(
		(e: React.MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
				if (canClose) onClose(tab.id);
			}
		},
		[onClose, tab.id, canClose]
	);

	const handleDoubleClick = useCallback(() => {
		onRename(tab.id);
	}, [onRename, tab.id]);

	const hoverBgColor = `${theme.colors.textDim}15`;

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
		[isActive, theme.colors, isHovered, hoverBgColor, isDragOver]
	);

	// Status dot: green = idle/busy (process alive), red = exited with error, dim = exited cleanly
	const statusColor =
		tab.state === 'idle' || tab.state === 'busy'
			? '#22c55e'
			: isExited && tab.exitCode !== 0
				? '#ef4444'
				: theme.colors.textDim;

	return (
		<div
			className={`relative flex items-center gap-1.5 px-3 py-1.5 cursor-pointer select-none shrink-0 transition-colors duration-100 ring-1 ring-inset ${isDragging ? 'opacity-40' : ''}`}
			style={tabStyle}
			onClick={handleClick}
			onMouseDown={handleMouseDown}
			onDoubleClick={handleDoubleClick}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			draggable
			onDragStart={(e) => onDragStart(tab.id, e)}
			onDragOver={(e) => onDragOver(tab.id, e)}
			onDragEnd={onDragEnd}
			onDrop={(e) => onDrop(tab.id, e)}
			title={displayName}
		>
			{/* Terminal icon */}
			<TerminalSquare
				className="w-3 h-3 shrink-0"
				style={{ color: isActive ? theme.colors.textMain : theme.colors.textDim }}
			/>

			{/* Status dot */}
			<span
				className="w-1.5 h-1.5 rounded-full shrink-0"
				style={{ backgroundColor: statusColor }}
			/>

			{/* Tab name */}
			<span
				className="text-xs truncate max-w-[120px]"
				style={{ color: isActive ? theme.colors.textMain : theme.colors.textDim }}
			>
				{displayName}
			</span>

			{/* Exit code indicator */}
			{isExited && tab.exitCode !== undefined && tab.exitCode !== 0 && (
				<span
					className="text-xs opacity-70 shrink-0"
					style={{ color: theme.colors.error }}
					title={`Exit code: ${tab.exitCode}`}
				>
					({tab.exitCode})
				</span>
			)}

			{/* Close button (visible on hover or when active, only if closeable) */}
			{canClose && (isHovered || isActive) && (
				<button
					onClick={handleClose}
					className="ml-0.5 p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
					style={{ color: theme.colors.textDim }}
					title="Close terminal"
				>
					<X className="w-3 h-3" />
				</button>
			)}
		</div>
	);
});

/**
 * Standalone terminal tab bar for terminal mode.
 * Renders a horizontal list of terminal tabs with drag-to-reorder and a new tab button.
 */
export const TerminalTabBar = memo(function TerminalTabBar({
	tabs,
	activeTabId,
	theme,
	onTabSelect,
	onTabClose,
	onNewTab,
	onRequestRename,
	onTabReorder,
}: TerminalTabBarProps) {
	const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
	const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
	const tabBarRef = useRef<HTMLDivElement>(null);

	const handleDragStart = useCallback((tabId: string, e: React.DragEvent) => {
		setDraggingTabId(tabId);
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', tabId);
	}, []);

	const handleDragOver = useCallback((_tabId: string, e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		setDragOverTabId(_tabId);
	}, []);

	const handleDragEnd = useCallback(() => {
		setDraggingTabId(null);
		setDragOverTabId(null);
	}, []);

	const handleDrop = useCallback(
		(toTabId: string, e: React.DragEvent) => {
			e.preventDefault();
			const fromTabId = e.dataTransfer.getData('text/plain');
			if (fromTabId && fromTabId !== toTabId && onTabReorder) {
				const fromIndex = tabs.findIndex((t) => t.id === fromTabId);
				const toIndex = tabs.findIndex((t) => t.id === toTabId);
				if (fromIndex !== -1 && toIndex !== -1) {
					onTabReorder(fromIndex, toIndex);
				}
			}
			setDraggingTabId(null);
			setDragOverTabId(null);
		},
		[onTabReorder, tabs]
	);

	const handleRename = useCallback(
		(tabId: string) => {
			onRequestRename?.(tabId);
		},
		[onRequestRename]
	);

	const canClose = tabs.length > 1;

	const newTabShortcutHint = formatShortcutKeys(['Ctrl', 'Shift', '`']);

	return (
		<div
			ref={tabBarRef}
			className="flex items-center border-b overflow-x-auto"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
				scrollbarWidth: 'thin',
			}}
		>
			{/* Tabs */}
			{tabs.map((tab, index) => (
				<SingleTerminalTab
					key={tab.id}
					tab={tab}
					index={index}
					isActive={tab.id === activeTabId}
					theme={theme}
					canClose={canClose}
					onSelect={onTabSelect}
					onClose={onTabClose}
					onDragStart={handleDragStart}
					onDragOver={handleDragOver}
					onDragEnd={handleDragEnd}
					onDrop={handleDrop}
					isDragging={draggingTabId === tab.id}
					isDragOver={dragOverTabId === tab.id}
					onRename={handleRename}
				/>
			))}

			{/* New tab button */}
			<button
				onClick={onNewTab}
				className="flex items-center justify-center w-8 h-8 opacity-60 hover:opacity-100 transition-opacity shrink-0"
				style={{ color: theme.colors.textDim }}
				title={`New terminal (${newTabShortcutHint})`}
			>
				<Plus className="w-4 h-4" />
			</button>
		</div>
	);
});
