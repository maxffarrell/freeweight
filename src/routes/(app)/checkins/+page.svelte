<script lang="ts">
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import { getTodayCheckIns, recordCheckIn } from '#lib/remote/members.remote.ts';
	import { getLocations, getSettings } from '#lib/remote/workspace.remote.ts';
	import { localTime } from '#lib/tz.ts';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import { errMsg } from '#lib/format.ts';
	import MonitorSmartphone from '@lucide/svelte/icons/monitor-smartphone';

	const settings = await getSettings();
	const locations = await getLocations();
	let checkIns = $state(await getTodayCheckIns());

	let code = $state('');
	let locationId = $state('');
	let pending = $state(false);
	let inputEl = $state<HTMLInputElement | null>(null);

	async function submit(e?: SubmitEvent) {
		e?.preventDefault();
		if (!code.trim()) return;
		pending = true;
		try {
			const r = await recordCheckIn({ code: code.trim(), locationId: locationId || undefined });
			toast.success(
				`${r.member.name} checked in` +
					(r.attended
						? ` — marked attended for ${r.attended} class${r.attended > 1 ? 'es' : ''}`
						: '')
			);
			code = '';
			checkIns = await getTodayCheckIns();
		} catch (err) {
			toast.error(errMsg(err, 'Check-in failed'));
		}
		pending = false;
		inputEl?.focus();
	}
</script>

<PageHeader title="Check-ins">
	{#snippet actions()}
		<Button size="sm" variant="outline" href="/kiosk"><MonitorSmartphone /> Open kiosk</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-3">
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"
				><QrCode /> Scan or enter a code</Card.Title
			>
			<Card.Description>
				Paste a member's QR code value, or their member ID. A USB scanner works too — it types and
				hits Enter.
			</Card.Description>
		</Card.Header>
		<Card.Content>
			<form class="space-y-4" onsubmit={submit}>
				<Field.Field>
					<Field.Label for="code">Code</Field.Label>
					<Input
						id="code"
						bind:ref={inputEl}
						bind:value={code}
						placeholder="fw1… or member ID"
						autocomplete="off"
						autofocus
						class="font-mono text-sm"
					/>
				</Field.Field>
				{#if locations.filter((l) => !l.archivedAt).length > 1}
					<Field.Field>
						<Field.Label>Location</Field.Label>
						<select
							bind:value={locationId}
							class="flex h-9 w-full rounded-md border bg-transparent px-3 text-sm"
						>
							<option value="">None</option>
							{#each locations.filter((l) => !l.archivedAt) as l (l.id)}
								<option value={l.id}>{l.name}</option>
							{/each}
						</select>
					</Field.Field>
				{/if}
				<Button type="submit" class="w-full" disabled={pending || !code.trim()}>
					<ScanLine />
					{pending ? 'Checking in…' : 'Check in'}
				</Button>
			</form>
		</Card.Content>
	</Card.Root>

	<Card.Root class="lg:col-span-2">
		<Card.Header>
			<Card.Title class="text-base">Today</Card.Title>
			<Card.Description
				>{checkIns.length} check-in{checkIns.length === 1 ? '' : 's'} so far.</Card.Description
			>
		</Card.Header>
		<Card.Content class="px-4">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Member</Table.Head>
						<Table.Head>Time</Table.Head>
						<Table.Head>Location</Table.Head>
						<Table.Head>Method</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each checkIns as c (c.checkIn.id)}
						<Table.Row>
							<Table.Cell class="font-medium">{c.memberName}</Table.Cell>
							<Table.Cell class="text-muted-foreground"
								>{localTime(c.checkIn.checkedAt, settings.timezone)}</Table.Cell
							>
							<Table.Cell class="text-muted-foreground">{c.locationName ?? '—'}</Table.Cell>
							<Table.Cell
								><Badge
									variant={c.checkIn.method === 'qr' ? 'default' : 'secondary'}
									class="uppercase">{c.checkIn.method}</Badge
								></Table.Cell
							>
						</Table.Row>
					{:else}
						<Table.Row
							><Table.Cell colspan={4} class="text-muted-foreground"
								>No check-ins yet today.</Table.Cell
							></Table.Row
						>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>
