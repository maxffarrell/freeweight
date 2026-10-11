<script lang="ts">
	import { page } from '$app/state';
	import Logo from '#lib/components/app/logo.svelte';
	import { Button } from '#lib/components/ui/button/index.js';
	import { getErrorBranding } from '#lib/remote/ee.remote.ts';

	let branding = $state({ appName: 'Freeweight', hideBranding: false });
	getErrorBranding()
		.then((b) => (branding = b))
		.catch(() => {});
</script>

<svelte:head><title>{page.status} · {branding.appName}</title></svelte:head>

<div class="flex min-h-svh items-center justify-center p-6">
	<div class="w-full max-w-sm space-y-6 text-center">
		{#if !branding.hideBranding}
			<div class="flex justify-center">
				<Logo class="size-9" />
			</div>
		{/if}
		<div class="space-y-1">
			<h1 class="text-2xl font-semibold tracking-tight">{page.status}</h1>
			<p class="text-sm text-muted-foreground">
				{page.error?.message ?? 'Something went wrong.'}
			</p>
		</div>
		<div class="flex justify-center gap-2">
			<Button href="/dashboard">Back to dashboard</Button>
			<Button variant="ghost" onclick={() => history.back()}>Go back</Button>
		</div>
	</div>
</div>
