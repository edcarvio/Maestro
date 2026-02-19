/**
 * TerminalTabBar - Tab bar for managing multiple terminal tabs.
 *
 * Simplified compared to TabBar.tsx (AI tabs):
 * - No star/unread functionality
 * - No context menu (merge, send to agent, etc.)
 * - Simple display names: "Terminal 1", "Terminal 2", or custom name
 * - Terminal icon color indicates state: green (exited 0), red (exited non-zero), yellow (busy)
 * - Middle-click closes tabs; double-click opens rename dialog
 */

import React, { useState, useCallback, memo, useMemo } from 'react';
import { X, Plus, Terminal as TerminalIcon } from 'lucide-react';
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
}: TerminalTabItemProps) {
	const [isHovered, setIsHovered] = useState(false);
	const displayName = useMemo(() => getTerminalTabDisplayName(tab, index), [tab.name, index]);
	const stateColor = useMemo(() => getStateColor(tab, theme), [tab.state, tab.exitCode, theme]);
	const isExited = tab.state === 'exited';

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
			onDragStart={onDragStart}
			onDragOver={onDragOver}
			onDragEnd={onDragEnd}
			onDrop={onDrop}
			onClick={onSelect}
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
			`}
			style={tabStyle}
		>
			{/* Terminal icon with state indicator */}
			<TerminalIcon
				className="w-3.5 h-3.5 flex-shrink-0"
				style={{ color: stateColor || (isActive ? theme.colors.textMain : theme.colors.textDim) }}
			/>

			{/* Tab name */}
			<span
				className={`text-xs font-medium ${isActive ? 'whitespace-nowrap' : 'truncate max-w-[120px]'}`}
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
	const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
	const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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
							onClose={() => onTabClose(tab.id)}
							onMiddleClick={() => canClose && onTabClose(tab.id)}
							onDragStart={handleDragStart(index)}
							onDragOver={handleDragOver(index)}
							onDragEnd={handleDragEnd}
							onDrop={handleDrop(index)}
							isDragging={draggingIndex === index}
							isDragOver={dragOverIndex === index}
							onRename={() => onRequestRename?.(tab.id)}
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
		</div>
	);
});
