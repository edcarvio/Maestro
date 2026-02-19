/**
 * TerminalTabRenameModal - Modal for renaming terminal tabs
 *
 * Simple modal with:
 * - Text input pre-filled with current name
 * - Save and Cancel buttons
 * - Enter to save, Escape to cancel
 * - Empty name saves as null (reverts to default "Terminal N")
 *
 * Follows the same pattern as RenameTabModal.tsx for AI tabs.
 */

import React, { useRef, useState } from 'react';
import type { Theme } from '../types';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { Modal, ModalFooter } from './ui/Modal';
import { FormInput } from './ui/FormInput';

interface TerminalTabRenameModalProps {
	theme: Theme;
	initialName: string;
	defaultName: string;
	onClose: () => void;
	onRename: (newName: string | null) => void;
}

export function TerminalTabRenameModal({
	theme,
	initialName,
	defaultName,
	onClose,
	onRename,
}: TerminalTabRenameModalProps) {
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState(initialName);

	const handleRename = () => {
		const trimmed = value.trim();
		onRename(trimmed || null);
		onClose();
	};

	return (
		<Modal
			theme={theme}
			title="Rename Terminal Tab"
			priority={MODAL_PRIORITIES.RENAME_TAB}
			onClose={onClose}
			width={400}
			initialFocusRef={inputRef as React.RefObject<HTMLElement>}
			footer={
				<ModalFooter
					theme={theme}
					onCancel={onClose}
					onConfirm={handleRename}
					confirmLabel="Rename"
				/>
			}
		>
			<FormInput
				ref={inputRef}
				theme={theme}
				value={value}
				onChange={setValue}
				onSubmit={handleRename}
				placeholder={defaultName}
				helperText={`Leave empty to use default name (${defaultName})`}
				selectOnFocus
			/>
		</Modal>
	);
}
