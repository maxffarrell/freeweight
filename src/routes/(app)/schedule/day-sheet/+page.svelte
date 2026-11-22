<script lang="ts">
	import { page } from '$app/state';
	import { getDaySheet } from '#lib/remote/schedule.remote.ts';
	import { getJoinInfo } from '#lib/remote/workspace.remote.ts';
	import { localTime } from '#lib/tz.ts';
	import { formatDate } from '#lib/format.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	const join = await getJoinInfo();
	let date = $state(page.url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10));
	let sheet = $state(await getDaySheet(date));
	async function reload() {
		if (isNaN(Date.parse(`${date}T00:00:00Z`))) return;
		sheet = await getDaySheet(date);
	}
</script>

<div class="mx-auto max-w-4xl space-y-6 p-6 print:p-0">
	<div class="flex flex-wrap items-center justify-between gap-2 print:hidden">
		<Button variant="ghost" size="sm" href="/schedule"><ArrowLeft /> Back to schedule</Button>
		<div class="flex items-center gap-2">
			<Input type="date" class="h-8 w-auto" bind:value={date} onchange={() => void reload()} />
			<Button size="sm" onclick={() => window.print()}><Printer /> Print / save as PDF</Button>
		</div>
	</div>

	<div class="bg-white px-14 py-14 text-neutral-900 print:px-0 print:py-0">
		<header class="flex items-start justify-between">
			<div>
				<p class="text-lg font-semibold">{join.name}</p>
				<p class="mt-1 text-neutral-500">Day sheet</p>
			</div>
			<dl class="w-72 space-y-5">
				<div class="grid grid-cols-[8rem_1fr] gap-x-4">
					<dt class="text-sm text-neutral-400">Date</dt>
					<dd class="text-sm">{formatDate(`${sheet.date}T12:00:00Z`)}</dd>
					<dt class="text-sm text-neutral-400">Sessions</dt>
					<dd class="text-sm">{sheet.sessions.length}</dd>
					<dt class="text-sm text-neutral-400">Printed</dt>
					<dd class="text-sm">{formatDate(new Date())}</dd>
				</div>
			</dl>
		</header>

		<h1 class="mt-16 text-right text-7xl font-bold tracking-tight">Day sheet</h1>
		<div class="mt-14"></div>

		{#each sheet.sessions as sess (sess.id)}
			<div class="mb-6 break-inside-avoid">
				<div class="mb-1 flex items-baseline justify-between gap-4 border-b pb-1">
					<h2 class="text-sm font-semibold tracking-wide uppercase">
						{localTime(sess.startsAt, sheet.tz)} — {sess.className}
						{#if sess.cancelled}<span class="text-destructive normal-case">(cancelled)</span>{/if}
						{#if sess.cover}<span class="text-amber-600 normal-case"> — needs cover</span>{/if}
					</h2>
					<p class="text-xs text-muted-foreground">
						{sess.instructor ?? 'Unassigned'}{#if sess.location}
							· {sess.location}{/if}
						· {Math.round((sess.endsAt.getTime() - sess.startsAt.getTime()) / 60000)} min
					</p>
				</div>
				{#if sess.note}
					<p class="mb-1 text-xs text-muted-foreground italic">{sess.note}</p>
				{/if}
				<table class="w-full text-sm">
					<tbody>
						{#each sess.roster as r (r.name + r.status)}
							<tr class="border-b border-dashed last:border-0">
								<td class="w-6 py-1 align-top">
									<span class="inline-block h-3 w-3 rounded-sm border"></span>
								</td>
								<td class="py-1">
									{r.name}{#if r.guests}
										<span class="text-muted-foreground">
											+{r.guests} guest{r.guests > 1 ? 's' : ''}
										</span>{/if}
								</td>
								<td class="py-1 text-right text-xs text-muted-foreground capitalize">
									{r.status === 'no_show' ? 'no-show' : r.status}
								</td>
							</tr>
						{:else}
							<tr><td colspan={3} class="py-1 text-muted-foreground">No bookings.</td></tr>
						{/each}
					</tbody>
				</table>
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">Nothing scheduled — pick another day.</p>
		{/each}
	</div>
</div>
