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
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import {
		getMembers,
		createMember,
		emailAllMembers,
		emailMeTest,
		getAnnouncementAudience,
		getRecentAnnouncements,
		getTags,
		importMembers
	} from '#lib/remote/members.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { parseCsv, toCsv } from '#lib/csv.ts';
	import { getCurrency, getPlans } from '#lib/remote/billing.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import Search from '@lucide/svelte/icons/search';
	import Download from '@lucide/svelte/icons/download';
	import Mail from '@lucide/svelte/icons/mail';
	import Upload from '@lucide/svelte/icons/upload';

	const currency = await getCurrency();
	const announcements = $derived(await getRecentAnnouncements());
	const allTags = $derived(await getTags());
	const audiencePlans = $derived((await getPlans()).filter((p) => p.active));
	let q = $state('');
	let tag = $state('__all');
	let statusFilter = $state('__all');
	let members = $state(await getMembers());
	let timer: ReturnType<typeof setTimeout> | undefined;
	async function refilter() {
		members = await getMembers({
			q,
			tag: tag === '__all' ? undefined : tag,
			status: statusFilter === '__all' ? undefined : (statusFilter as 'active' | 'inactive')
		});
	}
	function search() {
		clearTimeout(timer);
		timer = setTimeout(refilter, 150);
	}

	let open = $state(page.url.searchParams.get('new') === '1');
	let pending = $state(false);
	let name = $state('');
	let email = $state('');
	let phone = $state('');
	let status = $state<'active' | 'inactive'>('active');
	let birthday = $state('');

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
			await refilter();
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
				status,
				birthday: birthday || null
			});
			toast.success('Member added');
			open = false;
			name = email = phone = birthday = '';
			await refilter();
		} catch (err) {
			toast.error(errMsg(err, 'Could not add member'));
		}
		pending = false;
	}
	// ------- email all -------
	let emailOpen = $state(false);
	let emailSubject = $state('');
	let emailBody = $state('');
	let emailAudience = $state('__all');
	let emailPending = $state(false);
	const audTag = $derived(emailAudience.startsWith('tag:') ? emailAudience.slice(4) : undefined);
	const audPlan = $derived(emailAudience.startsWith('plan:') ? emailAudience.slice(5) : undefined);
	const audPlanName = $derived(
		audPlan ? (audiencePlans.find((p) => p.id === audPlan)?.name ?? 'plan') : ''
	);
	const audLabel = $derived(
		emailAudience === '__all'
			? 'All active members'
			: audTag
				? `Tag: ${audTag}`
				: `Plan: ${audPlanName}`
	);
	const audienceCount = $derived(
		emailOpen ? await getAnnouncementAudience({ tag: audTag, planId: audPlan }) : null
	);
	async function submitAnnouncement(e: SubmitEvent) {
		e.preventDefault();
		emailPending = true;
		try {
			const r = await emailAllMembers({
				subject: emailSubject,
				message: emailBody,
				tag: audTag,
				planId: audPlan
			});
			toast.success(r.total ? `Sent to ${r.sent} of ${r.total} members` : 'No members to email');
			emailOpen = false;
			emailSubject = emailBody = '';
			emailAudience = '__all';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send — try again'));
		}
		emailPending = false;
	}
	let testPending = $state(false);
	async function sendTest() {
		testPending = true;
		try {
			await emailMeTest({ subject: emailSubject, message: emailBody });
			toast.success('Test sent — check your inbox');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send test'));
		}
		testPending = false;
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
	<div class="flex max-w-xl gap-2">
		<div class="relative flex-1">
			<Search class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
			<Input
				placeholder="Search name, email, phone…"
				class="pl-9"
				bind:value={q}
				oninput={search}
			/>
		</div>
		<Select.Root type="single" bind:value={statusFilter} onValueChange={() => void refilter()}>
			<Select.Trigger class="w-32"
				>{statusFilter === '__all'
					? 'Any status'
					: statusFilter === 'active'
						? 'Active'
						: 'Inactive'}</Select.Trigger
			>
			<Select.Content>
				<Select.Item value="__all">Any status</Select.Item>
				<Select.Item value="active">Active</Select.Item>
				<Select.Item value="inactive">Inactive</Select.Item>
			</Select.Content>
		</Select.Root>
		{#if allTags.length}
			<Select.Root type="single" bind:value={tag} onValueChange={() => void refilter()}>
				<Select.Trigger class="w-36">{tag === '__all' ? 'All tags' : tag}</Select.Trigger>
				<Select.Content>
					<Select.Item value="__all">All tags</Select.Item>
					{#each allTags as t (t)}
						<Select.Item value={t}>{t}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
	</div>

	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head>Name</Table.Head>
						<Table.Head class="hidden md:table-cell">Contact</Table.Head>
						<Table.Head>Membership</Table.Head>
						<Table.Head class="hidden lg:table-cell">Last visit</Table.Head>
						<Table.Head>Status</Table.Head>
						<Table.Head class="text-right">Open balance</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each members as m (m.id)}
						<Table.Row class="cursor-pointer" onclick={() => goto(`/members/${m.id}`)}>
							<Table.Cell class="font-medium">
								{m.name}
								{#if m.tags.length}
									<span class="ml-1.5 inline-flex gap-1">
										{#each m.tags.slice(0, 3) as t (t)}
											<Badge variant="secondary" class="px-1.5 py-0 text-[10px]">{t}</Badge>
										{/each}
										{#if m.tags.length > 3}
											<Badge variant="secondary" class="px-1.5 py-0 text-[10px]"
												>+{m.tags.length - 3}</Badge
											>
										{/if}
									</span>
								{/if}
							</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground md:table-cell">
								{m.email ?? m.phone ?? '—'}
							</Table.Cell>
							<Table.Cell class="text-muted-foreground">{m.planName ?? '—'}</Table.Cell>
							<Table.Cell class="hidden text-muted-foreground lg:table-cell">
								{m.lastVisit ? formatDate(m.lastVisit) : '—'}
							</Table.Cell>
							<Table.Cell><StatusBadge status={m.status} /></Table.Cell>
							<Table.Cell class="text-right tabular-nums">
								{m.openBalance > 0 ? formatMoney(m.openBalance, currency) : '—'}
							</Table.Cell>
						</Table.Row>
					{:else}
						<Table.Row>
							<Table.Cell colspan={6}>
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
			<Field.Field>
				<Field.Label for="n-birthday">Birthday (optional)</Field.Label>
				<Input id="n-birthday" type="date" bind:value={birthday} />
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
			<Dialog.Title>Email members</Dialog.Title>
			<Dialog.Description>
				Goes to active members with an email on file — closures, schedule changes, news.
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
								{formatDate(a.createdAt)} · {a.sent} sent{a.tag ? ` · tag: ${a.tag}` : ''}{a.plan
									? ` · plan: ${a.plan}`
									: ''}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<form class="space-y-4" onsubmit={submitAnnouncement}>
			{#if allTags.length || audiencePlans.length}
				<Field.Field>
					<Field.Label for="a-audience">Audience</Field.Label>
					<Select.Root type="single" bind:value={emailAudience}>
						<Select.Trigger id="a-audience" class="w-full">
							{audLabel}
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="__all">All active members</Select.Item>
							{#each allTags as t (t)}
								<Select.Item value="tag:{t}">Tag: {t}</Select.Item>
							{/each}
							{#each audiencePlans as p (p.id)}
								<Select.Item value="plan:{p.id}">Plan: {p.name}</Select.Item>
							{/each}
						</Select.Content>
					</Select.Root>
				</Field.Field>
			{/if}
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
			<Dialog.Footer class="items-center justify-between sm:justify-between">
				<span class="text-xs text-muted-foreground">
					{audienceCount == null
						? ''
						: `Goes to ${audienceCount} member${audienceCount === 1 ? '' : 's'}`}
				</span>
				<div class="flex items-center gap-2">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onclick={sendTest}
						disabled={testPending || !emailSubject.trim() || !emailBody.trim()}
						>{testPending ? 'Sending…' : 'Send me a test'}</Button
					>
					<Button type="submit" disabled={emailPending || audienceCount === 0}>
						{emailPending
							? 'Sending…'
							: emailAudience === '__all'
								? 'Send to all members'
								: `Send to ${audLabel.replace(/^(Tag|Plan): /, '')}`}
					</Button>
				</div></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
