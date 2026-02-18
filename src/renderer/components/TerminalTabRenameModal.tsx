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
	onRename: (newName: string) => void;
}

export function TerminalTabRenameModal(props: TerminalTabRenameModalProps) {
	const { theme, initialName, defaultName, onClose, onRename } = props;
	const inputRef = useRef<HTMLInputElement>(null);
	const [value, setValue] = useState(initialName);

	const handleRename = () => {
		// Empty name saves as empty string — caller converts to null for default display
		onRename(value.trim());
		onClose();
	};

	return (
		<Modal
			theme={theme}
			title="Rename Terminal Tab"
			priority={MODAL_PRIORITIES.TERMINAL_TAB_RENAME}
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
