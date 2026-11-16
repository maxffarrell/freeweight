<script lang="ts">
	import Logo from '#lib/components/app/logo.svelte';
	let { children } = $props();
</script>

<div class="grid min-h-svh lg:grid-cols-2">
	<div class="flex flex-col justify-center p-8">
		<div class="mx-auto w-full max-w-sm">
			<a href="/" class="mb-8 flex items-center gap-2 font-semibold"><Logo /> Freeweight</a>
			{@render children()}
		</div>
	</div>
	<div
		class="hidden items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-neutral-800 lg:flex"
	>
		<div class="max-w-md px-10 text-neutral-200">
			<Logo class="mb-6 size-10 text-white" />
			<blockquote class="text-2xl leading-snug font-medium text-white">
				The gym, minus the busywork.
			</blockquote>
			<p class="mt-4 text-sm text-neutral-400">Members, memberships, bookings and check-ins.</p>
		</div>
	</div>
</div>
