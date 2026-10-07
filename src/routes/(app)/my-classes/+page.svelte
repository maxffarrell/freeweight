<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { getMyClasses, updateSession } from '#lib/remote/schedule.remote.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatDate } from '#lib/format.ts';
	import { localTime } from '#lib/tz.ts';

	const settings = await getSettings();
	const tz = settings.timezone;
	const classes = await getMyClasses();
	let toggling = $state<string | null>(null);

	async function toggleCover(id: string, on: boolean) {
		toggling = id;
		try {
			await updateSession({ id, needsCover: on });
			toast.success(on ? 'Marked as needing cover' : 'Cover request cleared');
			await getMyClasses().refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		toggling = null;
	}
</script>

<svelte:head><title>My classes · Freeweight</title></svelte:head>

<PageHeader title="My classes" />

<div class="mx-auto w-full max-w-3xl space-y-4">
	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Sessions you teach</Card.Title>
			<Card.Description>Next 2 weeks · live booked counts</Card.Description>
		</Card.Header>
		<Card.Content class="divide-y px-6 pb-4">
			{#if classes.length === 0}
				<p class="py-6 text-center text-sm text-muted-foreground">
					Nothing on the schedule for you yet.
				</p>
			{/if}
			{#each classes as row (row.session.id)}
				{@const needsCover = !!row.session.coverRequestedAt}
				<div class="flex items-center gap-3 py-3">
					<div class="min-w-0 flex-1">
						<div class="flex items-center gap-2">
							<span class="size-2.5 shrink-0 rounded-full" style:background={row.color ?? '#888'}
							></span>
							<a
								href="/schedule?focus={row.session.id}"
								class="truncate font-medium hover:underline">{row.className}</a
							>
							{#if needsCover}<Badge variant="secondary" class="text-amber-600">needs cover</Badge
								>{/if}
						</div>
						<div class="text-sm text-muted-foreground">
							{formatDate(row.session.startsAt)} · {localTime(
								row.session.startsAt,
								tz
							)}{#if row.locationName}
								· {row.locationName}{/if}
						</div>
					</div>
					<div class="text-sm whitespace-nowrap text-muted-foreground">
						{row.booked}/{row.session.capacity ?? '∞'}{#if row.waitlisted}
							<span class="text-amber-600"> +{row.waitlisted}</span>{/if}
					</div>
					<Button
						size="sm"
						variant={needsCover ? 'outline' : 'secondary'}
						disabled={toggling === row.session.id}
						onclick={() => toggleCover(row.session.id, !needsCover)}
					>
						{needsCover ? 'Clear cover' : 'Request cover'}
					</Button>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</div>
