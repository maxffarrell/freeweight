<script lang="ts">
	import * as Sidebar from '#lib/components/ui/sidebar/index.js';
	import AppSidebar from '#lib/components/app/app-sidebar.svelte';
	import CommandPalette from '#lib/components/app/command-palette.svelte';
	import type { LayoutProps } from './$types';

	let { children, data }: LayoutProps = $props();
	let searchOpen = $state(false);
</script>

<Sidebar.Provider>
	<AppSidebar user={data.user} org={data.org} onsearch={() => (searchOpen = true)} />
	<Sidebar.Inset>
		<main class="min-w-0 flex-1">
			{@render children()}
		</main>
	</Sidebar.Inset>
</Sidebar.Provider>
<CommandPalette bind:open={searchOpen} />
