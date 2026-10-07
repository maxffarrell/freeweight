<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { toast } from 'svelte-sonner';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let name = $state('');
	let pending = $state(false);
	const slug = $derived(
		name
			.toLowerCase()
			.trim()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-|-$/g, '')
			.slice(0, 40)
	);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		const { data: org, error } = await authClient.organization.create({
			name,
			slug: `${slug || 'gym'}-${Math.random().toString(36).slice(2, 6)}`
		});
		if (error || !org) {
			pending = false;
			return toast.error(error?.message ?? 'Could not create workspace');
		}
		await authClient.organization.setActive({ organizationId: org.id });
		await goto('/dashboard', { invalidateAll: true });
	}
</script>

<svelte:head><title>Set up your gym · Freeweight</title></svelte:head>

<div class="flex min-h-svh items-center justify-center p-6">
	<form class="w-full max-w-sm space-y-6" onsubmit={submit}>
		<Logo class="size-9" />
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold tracking-tight">
				Hi {data.name.split(' ')[0]}, name your gym
			</h1>
			<p class="text-sm text-muted-foreground">
				This is what members see on your public page and receipts. You can invite your team next.
			</p>
		</div>
		<Field.Field>
			<Field.Label for="org">Gym name</Field.Label>
			<Input id="org" placeholder="Iron Works Gym" required bind:value={name} autofocus />
		</Field.Field>
		<Button type="submit" class="w-full" disabled={pending || !name.trim()}
			>{pending ? 'Creating…' : 'Continue'}</Button
		>
	</form>
</div>
