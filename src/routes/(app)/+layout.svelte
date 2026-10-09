<script lang="ts">
	import DemoBanner from '#lib/components/app/demo-banner.svelte';
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import AppSidebar from '#lib/components/app/app-sidebar.svelte';
	import CommandPalette from '#lib/components/app/command-palette.svelte';
	import OnboardingTour from '#lib/components/app/onboarding-tour.svelte';
	import { tour } from '#lib/tour.svelte.ts';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	let searchOpen = $state(false);
</script>

<Sidebar.Provider>
	<AppSidebar
		user={data.user}
		org={data.org}
		onsearch={() => (searchOpen = true)}
		ontour={() => (tour.open = true)}
	/>
	<Sidebar.Inset>
		{#if data.demo && data.demoExpiresAt}
			<DemoBanner
				expiresAt={data.demoExpiresAt}
				serverNow={data.demoServerNow}
				deployUrl="https://github.com/maxffarrell/freeweight#quick-start"
			/>
		{/if}
		<main class="min-w-0 flex-1">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
<CommandPalette bind:open={searchOpen} />
<OnboardingTour bind:open={tour.open} orgName={data.org.name} />
