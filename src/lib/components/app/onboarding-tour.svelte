<script lang="ts">
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { markTourSeen } from '#lib/remote/workspace.remote.ts';
	import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
	import Users from '@lucide/svelte/icons/users';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import Wallet from '@lucide/svelte/icons/wallet';
	import ChartColumn from '@lucide/svelte/icons/chart-column';
	import Settings from '@lucide/svelte/icons/settings';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ChevronLeft from '@lucide/svelte/icons/chevron-left';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	interface Props {
		open: boolean;
		orgName: string;
	}
	let { open = $bindable(false), orgName }: Props = $props();

	// svelte-ignore state_referenced_locally
	const steps = [
		{
			icon: Sparkles,
			title: `Welcome to ${orgName}`,
			body: 'Everything your gym runs on lives in the sidebar. This 30-second tour hits each piece — you can replay it anytime from your profile menu.'
		},
		{
			icon: LayoutDashboard,
			title: 'Dashboard',
			body: "Today at a glance: classes, who's inside, pending member requests, birthdays, sessions needing cover, and memberships renewing this week."
		},
		{
			icon: Users,
			title: 'Members',
			body: 'Everyone who trains here — search, filter by plan, status, tag or balance, then email, merge or print statements. Each member page holds their whole history: bookings, charges, notes, documents and progress.'
		},
		{
			icon: CalendarDays,
			title: 'Schedule',
			body: 'Your weekly grid. Recurring templates fill it forever — one-off edits, instructor swaps and closures stick. Events and bookable amenities (sauna, courts) live here too.'
		},
		{
			icon: ScanLine,
			title: 'Check-ins',
			body: 'Open /kiosk on any tablet for a front-desk scanner — members scan their QR code in and out, guests and walk-ins are handled right there.'
		},
		{
			icon: Wallet,
			title: 'Plans & billing',
			body: 'Memberships, class packs, promo codes, retail, day passes. Connect a payment provider in Settings to take cards online — otherwise log payments at the desk.'
		},
		{
			icon: ChartColumn,
			title: 'Reports',
			body: 'Growth vs churn, revenue, class fill, busiest hours, instructor pay, retention by cohort, leads and events — the numbers that tell you what to fix next.'
		},
		{
			icon: Settings,
			title: 'Make it yours',
			body: 'Timezone, currency, logo, waiver, the public join page, booking policies and your team — all in Settings. Invite your staff there when you’re ready.'
		}
	];

	let step = $state(0);
	/** Set after the dialog has been opened once, so only a real close marks it seen. */
	let wasOpened = $state(false);
	$effect(() => {
		if (open) {
			step = 0;
			wasOpened = true;
		} else if (wasOpened) {
			wasOpened = false;
			void markTourSeen();
		}
	});

	const current = $derived(steps[step]!);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-md">
		<div class="flex flex-col items-center gap-4 py-2 text-center">
			<div class="rounded-xl bg-primary/10 p-3 text-primary">
				<current.icon class="h-7 w-7" />
			</div>
			<div>
				<h2 class="text-lg font-semibold">{current.title}</h2>
				<p class="mt-1.5 text-sm leading-relaxed text-muted-foreground">{current.body}</p>
			</div>
		</div>
		<div class="flex items-center justify-between gap-3">
			<div class="flex items-center gap-1.5" aria-label="Step {step + 1} of {steps.length}">
				{#each steps as _, i (i)}
					<span
						class="h-1.5 rounded-full transition-all {i === step
							? 'w-5 bg-primary'
							: 'w-1.5 bg-muted-foreground/30'}"
					></span>
				{/each}
			</div>
			<div class="flex items-center gap-1">
				{#if step > 0}
					<Button variant="ghost" size="sm" onclick={() => step--}>
						<ChevronLeft class="h-4 w-4" /> Back
					</Button>
				{/if}
				{#if step < steps.length - 1}
					<Button size="sm" onclick={() => step++}>
						Next <ChevronRight class="h-4 w-4" />
					</Button>
				{:else}
					<Button size="sm" onclick={() => (open = false)}>Get started</Button>
				{/if}
			</div>
		</div>
		<button
			class="absolute top-4 left-4 text-xs text-muted-foreground underline-offset-4 hover:underline"
			onclick={() => (open = false)}>Skip tour</button
		>
	</Dialog.Content>
</Dialog.Root>
