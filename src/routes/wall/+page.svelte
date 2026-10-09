<script lang="ts">
	import { getPrWall } from '#lib/remote/members.remote.ts';
	import { onMount } from 'svelte';
	import Logo from '#lib/components/app/logo.svelte';

	let { data } = $props();
	const prs = $derived(await getPrWall());
	const today = new Date().toISOString().slice(0, 10);
	const todays = $derived(prs.filter((p) => p.pr.recordedOn === today));
	const rest = $derived(prs.filter((p) => p.pr.recordedOn !== today));

	onMount(() => {
		const t = setInterval(() => void getPrWall().refresh(), 30_000);
		return () => clearInterval(t);
	});
</script>

<div class="min-h-svh bg-background p-8 md:p-12">
	<header class="mb-10 flex items-center gap-4">
		<Logo class="size-10" />
		<h1 class="text-3xl font-bold tracking-tight">{data.gymName} — PR board</h1>
	</header>

	{#if todays.length}
		<h2 class="mb-4 text-xl font-semibold text-muted-foreground">Today</h2>
		<ul class="mb-12 space-y-3">
			{#each todays as p (p.pr.id)}
				<li class="flex items-baseline gap-4">
					<span class="w-64 truncate text-2xl font-semibold">{p.memberName}</span>
					<span class="flex-1 truncate text-2xl text-muted-foreground">{p.pr.label}</span>
					<span class="text-3xl font-bold text-primary">{p.pr.value}</span>
				</li>
			{/each}
		</ul>
	{/if}

	<h2 class="mb-4 text-xl font-semibold text-muted-foreground">Recent records</h2>
	<ul class="space-y-2">
		{#each rest as p (p.pr.id)}
			<li class="flex items-baseline gap-4">
				<span class="w-24 shrink-0 text-lg text-muted-foreground">{p.pr.recordedOn}</span>
				<span class="w-64 truncate text-xl font-medium">{p.memberName}</span>
				<span class="flex-1 truncate text-xl text-muted-foreground">{p.pr.label}</span>
				<span class="text-2xl font-bold">{p.pr.value}</span>
			</li>
		{:else}
			<li class="text-xl text-muted-foreground">No records yet — members log PRs in the portal.</li>
		{/each}
	</ul>
</div>
