<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	let pending = $state(false);

	async function accept() {
		pending = true;
		const { data: res, error } = await authClient.organization.acceptInvitation({
			invitationId: data.id
		});
		if (error || !res) {
			pending = false;
			return toast.error(error?.message ?? 'This invitation is invalid or has expired');
		}
		await authClient.organization.setActive({ organizationId: res.invitation.organizationId });
		await goto('/dashboard', { invalidateAll: true });
	}
</script>

<svelte:head><title>Join workspace · Freeweight</title></svelte:head>

<div class="flex min-h-svh items-center justify-center p-6">
	<div class="w-full max-w-sm space-y-6 text-center">
		<Logo class="mx-auto size-10" />
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold tracking-tight">You've been invited</h1>
			<p class="text-sm text-muted-foreground">Signed in as {data.email}.</p>
		</div>
		<Button class="w-full" disabled={pending} onclick={accept}
			>{pending ? 'Joining…' : 'Accept invitation'}</Button
		>
	</div>
</div>
