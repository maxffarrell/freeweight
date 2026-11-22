<script lang="ts" module>
	class ConfirmDialogState {
		open = $state(false);
		inputText = $state('');
		options = $state<ConfirmDialogOptions | null>(null);
		loading = $state(false);

		constructor() {
			this.confirm = this.confirm.bind(this);
			this.cancel = this.cancel.bind(this);
		}

		newConfirmation(options: ConfirmDialogOptions) {
			this.reset();
			this.options = options;
			this.inputText = options.input?.defaultValue ?? '';
			this.open = true;
		}

		replaceConfirmation(options: ConfirmDialogOptions) {
			this.options = options;
			this.inputText = options.input?.defaultValue ?? '';
			this.loading = false;
			this.open = true;
		}

		reset() {
			this.open = false;
			this.inputText = '';
			this.options = null;
		}

		confirm() {
			if (this.loading) return;
			if (this.options?.input?.confirmationText) {
				if (this.inputText !== this.options.input.confirmationText) {
					return;
				}
			}

			const options = this.options;
			this.loading = true;
			Promise.resolve(options?.onConfirm(this.inputText))
				.then(() => {
					// onConfirm may have opened a follow-up dialog; only close if still ours
					if (this.options === options) this.open = false;
				})
				.finally(() => {
					this.loading = false;
				});
		}

		cancel() {
			this.options?.onCancel?.();
			this.open = false;
		}
	}

	const dialogState = new ConfirmDialogState();

	export type ConfirmDialogOptions = {
		title: string;
		description?: string;
		input?: {
			label?: string;
			placeholder?: string;
			defaultValue?: string;
			confirmationText?: string;
		};
		confirm?: {
			text?: string;
		};
		cancel?: {
			text?: string;
		};
		onConfirm: (value: string) => Promise<unknown> | unknown;
		onCancel?: () => void;
	};

	export function confirmDialog(options: ConfirmDialogOptions) {
		dialogState.newConfirmation(options);
	}

	/** Swap the open dialog's contents in place — used for chained multi-step questions. */
	export function replaceConfirmDialog(options: ConfirmDialogOptions) {
		dialogState.replaceConfirmation(options);
	}
</script>

<script lang="ts">
	import * as AlertDialog from '#lib/components/ui/alert-dialog/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import { Spinner } from '#lib/components/ui/spinner/index.js';
</script>

<AlertDialog.Root bind:open={dialogState.open}>
	<AlertDialog.Content>
		<form
			method="POST"
			onsubmit={(e) => {
				e.preventDefault();
				dialogState.confirm();
			}}
			class="flex flex-col gap-4"
		>
			<AlertDialog.Header>
				<AlertDialog.Title>
					{dialogState.options?.title}
				</AlertDialog.Title>
				{#if dialogState.options?.description}
					<AlertDialog.Description class="wrap-anywhere">
						{dialogState.options.description}
					</AlertDialog.Description>
				{/if}
			</AlertDialog.Header>
			{#if dialogState.options?.input}
				<div class="flex flex-col gap-1.5">
					{#if dialogState.options.input.label}
						<Label>{dialogState.options.input.label}</Label>
					{/if}
					<Input
						bind:value={dialogState.inputText}
						placeholder={dialogState.options.input.placeholder ??
							(dialogState.options.input.confirmationText
								? `Enter "${dialogState.options.input.confirmationText}" to confirm.`
								: '')}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								// for some reason without this the form will submit and the dialog will close immediately
								e.preventDefault();
								dialogState.confirm();
							}
						}}
					/>
				</div>
			{/if}
			<AlertDialog.Footer>
				<AlertDialog.Cancel type="button" onclick={dialogState.cancel}>
					{dialogState.options?.cancel?.text ?? 'Cancel'}
				</AlertDialog.Cancel>
				<AlertDialog.Action type="submit" disabled={dialogState.loading}>
					{#if dialogState.loading}<Spinner />{/if}
					{dialogState.options?.confirm?.text ?? 'Confirm'}
				</AlertDialog.Action>
			</AlertDialog.Footer>
		</form>
	</AlertDialog.Content>
</AlertDialog.Root>
