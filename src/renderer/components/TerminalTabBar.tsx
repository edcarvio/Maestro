/**
 * TerminalTabBar - Standalone terminal tab bar for terminal mode
 *
 * Displayed when the session is in terminal mode (Cmd+J).
 * Provides a tab strip with create, close, rename, and reorder support.
 *
 * This is separate from the unified TabBar which shows terminal tabs alongside
 * AI and file tabs in AI mode. TerminalTabBar is purpose-built for the
 * dedicated terminal mode experience via TerminalView.
 */

import React, { useState, useCallback, useMemo, memo } from 'react';
import { Plus, X, TerminalSquare, Loader2 } from 'lucide-react';
import type { Theme, TerminalTab } from '../types';
import { getTerminalTabDisplayName } from '../utils/terminalTabHelpers';

export interface TerminalTabBarProps {
	tabs: TerminalTab[];
	activeTabId: string | null;
	theme: Theme;
	onTabSelect: (tabId: string) => void;
	onTabClose: (tabId: string) => void;
	onNewTab: () => void;
	onRequestRename?: (tabId: string) => void;
	onTabReorder?: (fromIndex: number, toIndex: number) => void;
	onCloseOtherTabs?: (tabId: string) => void;
	onCloseTabsToRight?: (tabId: string) => void;
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
	// Drag state for tab reorder
	const [dragTabId, setDragTabId] = useState<string | null>(null);
	const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

	const handleDragStart = useCallback((tabId: string, e: React.DragEvent) => {
		setDragTabId(tabId);
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', tabId);
	}, []);

	const handleDragOver = useCallback((tabId: string, e: React.DragEvent) => {
		e.preventDefault();
		e.dataTransfer.dropEffect = 'move';
		setDragOverTabId(tabId);
	}, []);

	const handleDragEnd = useCallback(() => {
		setDragTabId(null);
		setDragOverTabId(null);
	}, []);

	const handleDrop = useCallback((targetTabId: string, e: React.DragEvent) => {
		e.preventDefault();
		const sourceTabId = dragTabId;
		setDragTabId(null);
		setDragOverTabId(null);

		if (!sourceTabId || sourceTabId === targetTabId || !onTabReorder) return;

		const fromIndex = tabs.findIndex(t => t.id === sourceTabId);
		const toIndex = tabs.findIndex(t => t.id === targetTabId);
		if (fromIndex >= 0 && toIndex >= 0) {
			onTabReorder(fromIndex, toIndex);
		}
	}, [dragTabId, tabs, onTabReorder]);

	return (
		<div
			className="flex items-end shrink-0 border-b overflow-x-auto"
			style={{
				backgroundColor: theme.colors.bgSidebar,
				borderColor: theme.colors.border,
			}}
			data-testid="terminal-tab-bar"
		>
			{tabs.map((tab, index) => (
				<TerminalTabItem
					key={tab.id}
					tab={tab}
					index={index}
					isActive={tab.id === activeTabId}
					theme={theme}
					onSelect={onTabSelect}
					onClose={onTabClose}
					onRequestRename={onRequestRename}
					onDragStart={handleDragStart}
					onDragOver={handleDragOver}
					onDragEnd={handleDragEnd}
					onDrop={handleDrop}
					isDragging={tab.id === dragTabId}
					isDragOver={tab.id === dragOverTabId}
				/>
			))}

			{/* New tab button */}
			<button
				onClick={onNewTab}
				className="flex items-center justify-center w-7 h-7 mx-1 my-auto rounded hover:bg-white/10 transition-colors shrink-0"
				style={{ color: theme.colors.textDim }}
				title="New terminal tab"
				data-testid="terminal-new-tab-button"
			>
				<Plus className="w-3.5 h-3.5" />
			</button>
		</div>
	);
});

// --- Individual tab item ---

interface TerminalTabItemProps {
	tab: TerminalTab;
	index: number;
	isActive: boolean;
	theme: Theme;
	onSelect: (tabId: string) => void;
	onClose: (tabId: string) => void;
	onRequestRename?: (tabId: string) => void;
	onDragStart: (tabId: string, e: React.DragEvent) => void;
	onDragOver: (tabId: string, e: React.DragEvent) => void;
	onDragEnd: () => void;
	onDrop: (tabId: string, e: React.DragEvent) => void;
	isDragging: boolean;
	isDragOver: boolean;
}

const TerminalTabItem = memo(function TerminalTabItem({
	tab,
	index,
	isActive,
	theme,
	onSelect,
	onClose,
	onRequestRename,
	onDragStart,
	onDragOver,
	onDragEnd,
	onDrop,
	isDragging,
	isDragOver,
}: TerminalTabItemProps) {
	const [isHovered, setIsHovered] = useState(false);

	const handleClick = useCallback(() => {
		onSelect(tab.id);
	}, [onSelect, tab.id]);

	const handleDoubleClick = useCallback(() => {
		onRequestRename?.(tab.id);
	}, [onRequestRename, tab.id]);

	const handleClose = useCallback((e: React.MouseEvent) => {
		e.stopPropagation();
		onClose(tab.id);
	}, [onClose, tab.id]);

	// Middle-click to close
	const handleMouseDown = useCallback((e: React.MouseEvent) => {
		if (e.button === 1) {
			e.preventDefault();
			onClose(tab.id);
		}
	}, [onClose, tab.id]);

	// Status: green dot = running, dim dot = exited, spinner = spawning
	const isSpawning = tab.processRunning === undefined && tab.exitCode === undefined;
	const statusColor = tab.processRunning === true ? '#22c55e' : theme.colors.textDim;

	const hoverBgColor = `${theme.colors.textDim}15`;
	const tabStyle = useMemo(() => ({
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
	} as React.CSSProperties), [isActive, theme.colors, isHovered, hoverBgColor, isDragOver]);

	const displayName = getTerminalTabDisplayName(tab, index);

	return (
		<div
			className={`relative flex items-center gap-1.5 px-3 py-1.5 cursor-pointer select-none shrink-0 transition-colors duration-100 ring-1 ring-inset ${isDragging ? 'opacity-40' : ''}`}
			style={tabStyle}
			onClick={handleClick}
			onDoubleClick={handleDoubleClick}
			onMouseDown={handleMouseDown}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			draggable
			onDragStart={(e) => onDragStart(tab.id, e)}
			onDragOver={(e) => onDragOver(tab.id, e)}
			onDragEnd={onDragEnd}
			onDrop={(e) => onDrop(tab.id, e)}
			title={`${displayName} — ${tab.cwd}`}
			data-testid={`terminal-tab-${tab.id}`}
		>
			{/* Terminal icon */}
			<TerminalSquare
				className="w-3 h-3 shrink-0"
				style={{ color: isActive ? theme.colors.textMain : theme.colors.textDim }}
			/>

			{/* Status indicator: spinner while PTY is spawning, dot when running/exited */}
			{isSpawning ? (
				<span data-testid="terminal-tab-spinner" className="shrink-0 flex items-center">
					<Loader2
						className="w-3 h-3 animate-spin"
						style={{ color: theme.colors.accent }}
					/>
				</span>
			) : (
				<span
					className="w-1.5 h-1.5 rounded-full shrink-0"
					style={{ backgroundColor: statusColor }}
					data-testid="terminal-tab-status-dot"
				/>
			)}

			{/* Tab name */}
			<span
				className="text-xs truncate max-w-[150px]"
				style={{ color: isActive ? theme.colors.textMain : theme.colors.textDim }}
			>
				{displayName}
			</span>

			{/* Close button (visible on hover or when active) */}
			{(isHovered || isActive) && (
				<button
					onClick={handleClose}
					className="ml-0.5 p-0.5 rounded hover:bg-white/10 transition-colors shrink-0"
					style={{ color: theme.colors.textDim }}
					data-testid={`terminal-tab-close-${tab.id}`}
				>
					<X className="w-3 h-3" />
				</button>
			)}
		</div>
	);
});
