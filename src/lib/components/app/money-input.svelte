<script lang="ts">
	import * as InputGroup from '#lib/components/ui/input-group/index.js';
	import { untrack } from 'svelte';

	/** Two-way bound value is in cents. */
	let {
		value = $bindable<number | null>(null),
		id,
		required = false,
		placeholder = '0.00'
	}: { value?: number | null; id?: string; required?: boolean; placeholder?: string } = $props();
	const format = (cents: number | null) => (cents == null ? '' : (cents / 100).toFixed(2));
	const parse = (t: string) => {
		const n = Number.parseFloat(t.replace(/[,$\s]/g, ''));
		return Number.isFinite(n) ? Math.round(n * 100) : null;
	};

	let text = $state(format(value));
	let focused = $state(false);

	// Reflect values set from outside (prefills, shortcuts), but never while the user is typing.
	$effect.pre(() => {
		const next = value;
		if (!focused && untrack(() => parse(text)) !== next) text = format(next);
	});

	function oninput(e: Event) {
		text = (e.currentTarget as HTMLInputElement).value;
		value = parse(text);
	}
</script>

<InputGroup.Root>
	<InputGroup.Addon><InputGroup.Text>$</InputGroup.Text></InputGroup.Addon>
	<InputGroup.Input
		{id}
		{required}
		{placeholder}
		inputmode="decimal"
		class="tabular-nums"
		value={text}
		{oninput}
		onfocus={() => (focused = true)}
		onblur={() => (focused = false)}
	/>
</InputGroup.Root>
