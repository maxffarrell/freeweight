<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import { getActivity, getActivityTypes, getSettings } from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatRelative } from '#lib/format.ts';
	import { localTime, localDate } from '#lib/tz.ts';

	const settings = await getSettings();
	const types = await getActivityTypes();

	const PAGE = 50;
	let entityType = $state('all');
	// 51 rows come back per fetch — the +1 tells us another page exists.
	const first = await getActivity({});
	let items = $state(first.slice(0, PAGE));
	let hasMore = $state(first.length > PAGE);
	let loadingMore = $state(false);

	async function refilter() {
		const r = await getActivity({
			entityType: entityType === 'all' ? undefined : entityType
		});
		items = r.slice(0, PAGE);
		hasMore = r.length > PAGE;
	}

	async function loadMore() {
		const last = items[items.length - 1];
		if (!last) return;
		loadingMore = true;
		try {
			const next = await getActivity({
				entityType: entityType === 'all' ? undefined : entityType,
				before: new Date(last.createdAt).toISOString()
			});
			items = [...items, ...next.slice(0, PAGE)];
			hasMore = next.length > PAGE;
		} catch (err) {
			toast.error(errMsg(err, 'Could not load more'));
		}
		loadingMore = false;
	}

	const TYPE_LABELS: Record<string, string> = {
		membership: 'Membership',
		member: 'Member',
		check_in: 'Check-in',
		payment: 'Payment',
		booking: 'Booking',
		charge: 'Charge',
		announcement: 'Announcement',
		class_session: 'Session',
		class_template: 'Template',
		document: 'Document',
		closure: 'Closure'
	};
	const typeLabel = (t: string) => TYPE_LABELS[t] ?? t.replaceAll('_', ' ');
</script>

<svelte:head><title>Activity · Freeweight</title></svelte:head>

<PageHeader title="Activity" />

<div class="mx-auto w-full max-w-3xl space-y-4">
	<Card.Root>
		<Card.Header class="flex flex-row items-center justify-between gap-3">
			<div>
				<Card.Title class="text-base">Audit log</Card.Title>
				<Card.Description>Every staff and system event — who did what, when.</Card.Description>
			</div>
			<Select.Root type="single" bind:value={entityType} onValueChange={() => void refilter()}>
				<Select.Trigger class="w-44">
					{entityType === 'all' ? 'All activity' : typeLabel(entityType)}
				</Select.Trigger>
				<Select.Content>
					<Select.Item value="all">All activity</Select.Item>
					{#each types as t (t)}
						<Select.Item value={t}>{typeLabel(t)}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		</Card.Header>
		<Card.Content class="divide-y p-0">
			{#each items as a (a.id)}
				<div class="flex items-start gap-3 px-6 py-3">
					<div class="mt-0.5 w-20 shrink-0 text-xs text-muted-foreground">
						{formatRelative(a.createdAt)}
					</div>
					<div class="min-w-0 flex-1">
						<p class="text-sm">{a.summary}</p>
						<p class="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<Badge variant="outline" class="font-normal"
								>{typeLabel(a.entityType)} · {a.action}</Badge
							>
							{#if a.actorName}<span>{a.actorName}</span>{/if}
							<span
								>{localDate(new Date(a.createdAt), settings.timezone)} · {localTime(
									a.createdAt,
									settings.timezone
								)}</span
							>
						</p>
					</div>
				</div>
			{:else}
				<p class="px-6 py-8 text-center text-sm text-muted-foreground">
					No activity yet — events appear here as staff and members do things.
				</p>
			{/each}
		</Card.Content>
		{#if hasMore && items.length > 0}
			<Card.Footer class="justify-center">
				<Button variant="outline" size="sm" onclick={loadMore} disabled={loadingMore}>
					{loadingMore ? 'Loading…' : 'Load older'}
				</Button>
			</Card.Footer>
		{/if}
	</Card.Root>
</div>
