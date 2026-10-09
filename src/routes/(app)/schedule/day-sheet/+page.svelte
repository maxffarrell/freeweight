<script lang="ts">
	import { page } from '$app/state';
	import { getDaySheet } from '#lib/remote/schedule.remote.ts';
	import { getJoinInfo } from '#lib/remote/workspace.remote.ts';
	import { localTime } from '#lib/tz.ts';
	import { formatDate } from '#lib/format.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import Printer from '@lucide/svelte/icons/printer';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';

	const join = await getJoinInfo();
	let date = $state(
		page.url.searchParams.get('date') ?? new Date().toISOString().slice(0, 10)
	);
	let sheet = $state(await getDaySheet(date));
	async function reload() {
		sheet = await getDaySheet(date);
	}
</script>

<div class="mx-auto max-w-3xl space-y-6 p-6">
	<div class="flex flex-wrap items-center justify-between gap-2 print:hidden">
		<Button variant="ghost" size="sm" href="/schedule"><ArrowLeft /> Back to schedule</Button>
		<div class="flex items-center gap-2">
			<input
				type="date"
				class="h-8 rounded-md border bg-background px-2 text-sm"
				bind:value={date}
				onchange={() => void reload()}
			/>
			<Button size="sm" onclick={() => window.print()}><Printer /> Print / save as PDF</Button>
		</div>
	</div>

	<div class="rounded-lg border p-8">
		<div class="mb-6 flex items-start justify-between gap-4">
			<div>
				<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">
					{join.name}
				</p>
				<h1 class="text-2xl font-semibold">Day sheet — {formatDate(`${sheet.date}T12:00:00Z`)}</h1>
				<p class="mt-1 text-sm text-muted-foreground">
					{sheet.sessions.length} session{sheet.sessions.length === 1 ? '' : 's'} · printed {formatDate(
						new Date()
					)}
				</p>
			</div>
		</div>

		{#each sheet.sessions as sess (sess.id)}
			<div class="mb-6 break-inside-avoid">
				<div class="mb-1 flex items-baseline justify-between gap-4 border-b pb-1">
					<h2 class="text-sm font-semibold tracking-wide uppercase">
						{localTime(sess.startsAt, sheet.tz)} — {sess.className}
						{#if sess.cancelled}<span class="text-destructive normal-case">(cancelled)</span>{/if}
					</h2>
					<p class="text-xs text-muted-foreground">
						{sess.instructor ?? 'Unassigned'}{#if sess.location}
							· {sess.location}{/if}
						· {Math.round((sess.endsAt.getTime() - sess.startsAt.getTime()) / 60000)} min
					</p>
				</div>
				<table class="w-full text-sm">
					<tbody>
						{#each sess.roster as r (r.name + r.status)}
							<tr class="border-b border-dashed last:border-0">
								<td class="w-6 py-1 align-top"><span class="inline-block h-3 w-3 rounded-sm border"></span></td>
								<td class="py-1">
									{r.name}{#if r.guests}
										<span class="text-muted-foreground"> +{r.guests} guest{r.guests > 1 ? 's' : ''}</span
										>{/if}
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
