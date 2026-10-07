<script lang="ts">
	import { goto } from '$app/navigation';
	import { authClient } from '#lib/auth-client.ts';
	import Logo from '#lib/components/app/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Skeleton } from '#lib/components/ui/skeleton/index.js';

	let { children, data } = $props();
</script>

<div class="min-h-svh bg-muted/30">
	<header class="border-b bg-background">
		<div class="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
			<Logo />
			<span class="font-semibold">Member portal</span>
			<span class="ml-auto hidden text-sm text-muted-foreground sm:block">{data.user.email}</span>
			<Button
				size="sm"
				variant="ghost"
				onclick={async () => {
					await authClient.signOut();
					await goto('/login', { invalidateAll: true });
				}}>Sign out</Button
			>
		</div>
	</header>
	<main class="mx-auto max-w-3xl space-y-6 p-4 py-8">
		<svelte:boundary>
			{@render children()}
			{#snippet pending()}<Skeleton class="h-40 w-full" />{/snippet}
		</svelte:boundary>
	</main>
</div>
