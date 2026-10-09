<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getActivity,
		getActivityActors,
		getActivityActions,
		getActivityTypes,
		getSettings
	} from '#lib/remote/workspace.remote.ts';
	import { errMsg, formatRelative } from '#lib/format.ts';
	import { toCsv } from '#lib/csv.ts';
	import { localTime, localDate } from '#lib/tz.ts';

	const settings = await getSettings();
	const types = await getActivityTypes();
	const actors = await getActivityActors();
	const actions = await getActivityActions();

	const PAGE = 50;
	let entityType = $state('all');
	let actorId = $state('all');
	let actionFilter = $state('all');
	// 51 rows come back per fetch — the +1 tells us another page exists.
	const first = await getActivity({});
	let items = $state(first.slice(0, PAGE));
	let q = $state('');
	const shown = $derived(
		q.trim() ? items.filter((a) => a.summary.toLowerCase().includes(q.trim().toLowerCase())) : items
	);
	let hasMore = $state(first.length > PAGE);
	let loadingMore = $state(false);

	async function refilter() {
		const r = await getActivity({
			entityType: entityType === 'all' ? undefined : entityType,
			actorId: actorId === 'all' ? undefined : actorId,
			action: actionFilter === 'all' ? undefined : actionFilter
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
				actorId: actorId === 'all' ? undefined : actorId,
				action: actionFilter === 'all' ? undefined : actionFilter,
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

	function exportCsv() {
		const csv = toCsv([
			['When', 'Actor', 'Type', 'Action', 'Summary'],
			...items.map((a) => [
				new Date(a.createdAt).toISOString(),
				a.actorName ?? '',
				typeLabel(a.entityType),
				a.action,
				a.summary
			])
		]);
		const el = document.createElement('a');
		el.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		el.download = `activity-${new Date().toISOString().slice(0, 10)}.csv`;
		el.click();
		URL.revokeObjectURL(el.href);
	}
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
			<div class="flex items-center gap-2">
				<Button variant="outline" size="sm" onclick={exportCsv} disabled={!items.length}
					>Export</Button
				>
				{#if actors.length > 1}
					<Input placeholder="Search…" class="w-36" bind:value={q} />
					<Select.Root type="single" bind:value={actorId} onValueChange={() => void refilter()}>
						<Select.Trigger class="w-36">
							{actorId === 'all' ? 'Everyone' : actors.find((a) => a.id === actorId)?.name}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all">Everyone</Select.Item>
							{#each actors as a (a.id)}
								<Select.Item value={a.id}>{a.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
				{#if actions.length > 1}
					<Select.Root
						type="single"
						bind:value={actionFilter}
						onValueChange={() => void refilter()}
					>
						<Select.Trigger class="w-32">
							{actionFilter === 'all' ? 'Any action' : actionFilter}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all">Any action</Select.Item>
							{#each actions as act (act)}
								<Select.Item value={act}>{act}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				{/if}
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
			</div>
		</Card.Header>
		<Card.Content class="divide-y p-0">
			{#each shown as a (a.id)}
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
