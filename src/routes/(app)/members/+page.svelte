<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Empty from '#lib/components/ui/empty/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getMembers,
		createMember,
		emailAllMembers,
		getRecentAnnouncements,
		importMembers
	} from '#lib/remote/members.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { parseCsv, toCsv } from '#lib/csv.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import Search from '@lucide/svelte/icons/search';
	import Download from '@lucide/svelte/icons/download';
	import Mail from '@lucide/svelte/icons/mail';
	import Upload from '@lucide/svelte/icons/upload';

	const currency = await getCurrency();
	const announcements = $derived(await getRecentAnnouncements());
	let q = $state('');
	let members = $state(await getMembers());
	let timer: ReturnType<typeof setTimeout> | undefined;
	function search() {
		clearTimeout(timer);
		timer = setTimeout(async () => (members = await getMembers({ q })), 150);
	}

	let open = $state(page.url.searchParams.get('new') === '1');
	let pending = $state(false);
	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let status = $state<'active' | 'inactive'>('active');

	// ------- csv import -------
	let importOpen = $state(false);
	let importText = $state('');
	let importPending = $state(false);
	/** Parsed rows — a leading header row (name,email,phone,…) is dropped, blank names skipped. */
	const importRows = $derived.by(() => {
		let rows = parseCsv(importText).map((r) => ({
			name: r[0]?.trim() ?? '',
			email: r[1]?.trim() ?? '',
			phone: r[2]?.trim() ?? ''
		}));
		if (rows.length && rows[0]!.name.toLowerCase() === 'name') rows = rows.slice(1);
		return rows.filter((r) => r.name);
	});

	function onImportFile(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		file?.text().then((t) => (importText = t));
	}

	async function runImport() {
		importPending = true;
		try {
			const r = await importMembers(
				importRows.map((row) => ({ name: row.name, email: row.email, phone: row.phone || null }))
			);
			toast.success(
				`Imported ${r.created} member${r.created === 1 ? '' : 's'}${r.skipped ? ` — skipped ${r.skipped} duplicate${r.skipped === 1 ? '' : 's'}` : ''}`
			);
			importOpen = false;
			importText = '';
			members = await getMembers({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Import failed'));
		}
		importPending = false;
	}

	function exportCsv() {
		const csv = toCsv([
			['Name', 'Email', 'Phone', 'Status', 'Location', 'Plan', 'Open balance', 'Joined'],
			...members.map((m) => [
				m.name,
				m.email,
				m.phone,
				m.status,
				m.locationName,
				m.planName,
				(m.openBalance / 100).toFixed(2),
				m.joinedAt ? formatDate(m.joinedAt) : ''
			])
		]);
		const a = document.createElement('a');
		a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
		a.download = `members-${new Date().toISOString().slice(0, 10)}.csv`;
		a.click();
		URL.revokeObjectURL(a.href);
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createMember({
				name,
				email: email || undefined,
				phone: phone || undefined,
				status
			});
			toast.success('Member added');
			open = false;
			name = email = phone = '';
			members = await getMembers({ q });
		} catch (err) {
			toast.error(errMsg(err, 'Could not add member'));
		}
		pending = false;
	}
	// ------- email all -------
	let emailOpen = $state(false);
	let emailSubject = $state('');
	let emailBody = $state('');
	let emailPending = $state(false);
	async function submitAnnouncement(e: SubmitEvent) {
		e.preventDefault();
		emailPending = true;
		try {
			const r = await emailAllMembers({ subject: emailSubject, message: emailBody });
			toast.success(r.total ? `Sent to ${r.sent} of ${r.total} members` : 'No members to email');
			emailOpen = false;
			emailSubject = emailBody = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send — try again'));
		}
		emailPending = false;
	}
</script>

<PageHeader title="Members">
	{#snippet actions()}
		<Button size="sm" variant="outline" onclick={() => (importOpen = true)}
			><Upload /> Import</Button
		>
		<Button size="sm" variant="outline" onclick={exportCsv}><Download /> Export</Button>
		<Button size="sm" variant="outline" onclick={() => (emailOpen = true)}><Mail /> Email</Button>
		<Button size="sm" onclick={() => (open = true)}><Plus /> Add member</Button>
	{/snippet}
</PageHeader>

<div class="space-y-4 p-4 md:p-6">
	<div class="relative max-w-sm">
		<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
		<Input placeholder="Search name, email, phone…" class="pl-9" bind:value={q} oninput={search} />
	</div>

	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head class="hidden md:table-cell">Contact</Table.Head>
						<Table.Head>Membership</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Open balance</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each members as m (m.id)}
						<Table.Row class="cursor-pointer" onclick={() => goto(`/members/${m.id}`)}>
							<Table.Cell class="font-medium">{m.name}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">
								{m.email ?? m.phone ?? '—'}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{m.planName ?? '—'}</Table.Cell>
							<Table.Cell><StatusBadge status={m.status} /></Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{m.openBalance > 0 ? formatMoney(m.openBalance, currency) : '—'}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={5}>
								<Empty.Root class="border-0">
									<Empty.Header>
										<Empty.Media><Users /></Empty.Media>
										<Empty.Title>No members yet</Empty.Title>
										<Empty.Description
											>Add your first member, or load the demo data to look around.</Empty.Description
										>
									</Empty.Header>
									<Empty.Content
										><Button onclick={() => (open = true)}>Add member</Button></Empty.Content
									>
								</Empty.Root>
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</Card.Content>
	</Card.Root>
</div>

<Dialog.Root bind:open>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add member</Dialog.Title>
			<Dialog.Description
				>A name is enough to start — contact details are optional.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submit}>
			<Field.Field>
				<Field.Label for="m-name">Name</Field.Label>
				<Input id="m-name" required bind:value={name} autofocus />
			</Field.Field>
			<Field.Field>
				<Field.Label for="m-email">Email</Field.Label>
				<Input id="m-email" type="email" bind:value={email} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="m-phone">Phone</Field.Label>
				<Input id="m-phone" bind:value={phone} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Status</Field.Label>
				<Select.Root type="single" bind:value={status}>
					<Select.Trigger class="w-full">{status}</Select.Trigger>
					<Select.Content>
						<Select.Item value="active">active</Select.Item>
						<Select.Item value="inactive">inactive</Select.Item>
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={pending}>{pending ? 'Adding…' : 'Add member'}</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={importOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Import members</Dialog.Title>
			<Dialog.Description>
				Paste CSV or pick a file — columns: name, email, phone (header row optional). Members whose
				email is already in use are skipped.
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-3">
			<Input type="file" accept=".csv,text/csv,text/plain" onchange={onImportFile} />
			<Textarea
				rows={6}
				class="font-mono text-xs"
				placeholder="name,email,phone&#10;Jane Doe,jane@example.com,555-1234"
				bind:value={importText}
			/>
			{#if importText.trim()}
				<p class="text-xs text-muted-foreground">
					{importRows.length} member{importRows.length === 1 ? '' : 's'} ready to import
				</p>
			{/if}
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (importOpen = false)}>Cancel</Button>
			<Button onclick={runImport} disabled={importPending || !importRows.length}>
				{importPending ? 'Importing…' : `Import ${importRows.length || ''}`}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={emailOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Email all members</Dialog.Title>
			<Dialog.Description>
				Goes to every active member with an email on file — closures, schedule changes, news.
			</Dialog.Description>
		</Dialog.Header>
		{#if announcements.length}
			<div class="rounded-md border bg-muted/40 p-3 text-sm">
				<p class="mb-2 font-medium text-muted-foreground">Recently sent</p>
				<ul class="space-y-1.5">
					{#each announcements as a (a.id)}
						<li class="flex items-baseline justify-between gap-3">
							<span class="truncate">{a.subject}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								{formatDate(a.createdAt)} · {a.sent} sent
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<form class="space-y-4" onsubmit={submitAnnouncement}>
			<Field.Field>
				<Field.Label for="a-subject">Subject</Field.Label>
				<Input id="a-subject" required bind:value={emailSubject} autofocus />
			</Field.Field>
			<Field.Field>
				<Field.Label for="a-body">Message</Field.Label>
				<Textarea
					id="a-body"
					required
					bind:value={emailBody}
					rows={6}
					placeholder="Hi everyone — we're closed this Thursday for maintenance…"
				/>
			</Field.Field>
			<Dialog.Footer
				><Button type="submit" disabled={emailPending}>
					{emailPending ? 'Sending…' : 'Send to all members'}
				</Button></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
