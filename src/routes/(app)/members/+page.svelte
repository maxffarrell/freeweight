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
		scheduleEmail,
		cancelScheduledEmail,
		getAnnouncementAudience,
		getRecentAnnouncements,
		getTags,
		getDuplicates,
		importMembers,
		tagMembers
	} from '#lib/remote/members.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import {
		getChallenges,
		createChallenge,
		updateChallenge
	} from '#lib/remote/challenges.remote.ts';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import Trophy from '@lucide/svelte/icons/trophy';
	import { parseCsv, toCsv } from '#lib/csv.ts';
	import { getCurrency, getPlans } from '#lib/remote/billing.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import Search from '@lucide/svelte/icons/search';
	import Download from '@lucide/svelte/icons/download';
	import Mail from '@lucide/svelte/icons/mail';
	import TagIcon from '@lucide/svelte/icons/tag';
	import Upload from '@lucide/svelte/icons/upload';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import { SvelteSet } from 'svelte/reactivity';
	import { aiDraftEmail, getAiStatus } from '#lib/remote/ai.remote.ts';

	const currency = await getCurrency();
	const ai = await getAiStatus();
	const announcements = $derived(await getRecentAnnouncements());
	const allTags = $derived(await getTags());
	const audiencePlans = $derived((await getPlans()).filter((p) => p.active));
	let q = $state('');
	let tag = $state('__all');
	let statusFilter = $state('__all');
	let planFilter = $state('__all');
	// Deep links like /members?owes=1 (billing aging card) preselect the balance filter.
	const initOwes = page.url.searchParams.get('owes') === '1';
	const SORT_LABELS = {
		name: 'Name A–Z',
		joined: 'Newest',
		lastVisit: 'Last visit',
		balance: 'Balance due'
	} as const;
	let sort = $state<keyof typeof SORT_LABELS>('name');
	let owesFilter = $state(initOwes ? 'owes' : 'any');
	let members = $state(await getMembers({ owes: initOwes || undefined }));
	const dupes = await getDuplicates();
	const initials = (name: string) =>
		name
			.split(/\s+/)
			.map((w) => w[0])
			.filter(Boolean)
			.slice(0, 2)
			.join('')
			.toUpperCase();

	// ------- bulk selection + tag -------
	const selected = new SvelteSet<string>();
	let tagOpen = $state(false);
	let bulkTag = $state('');
	let tagPending = $state(false);
	function toggleSelect(memberId: string) {
		if (selected.has(memberId)) selected.delete(memberId);
		else selected.add(memberId);
	}
	function toggleAll() {
		if (selected.size === members.length) selected.clear();
		else for (const m of members) selected.add(m.id);
	}
	async function applyBulkTag(e: SubmitEvent) {
		e.preventDefault();
		tagPending = true;
		try {
			const n = await tagMembers({ memberIds: [...selected], tag: bulkTag });
			toast.success(n ? `Tagged ${n} member${n === 1 ? '' : 's'}` : 'Nobody matched');
			if (n) {
				selected.clear();
				bulkTag = '';
				tagOpen = false;
				await refilter();
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not tag members'));
		}
		tagPending = false;
	}
	let timer: ReturnType<typeof setTimeout> | undefined;
	async function refilter() {
		members = await getMembers({
			q,
			tag: tag === '__all' ? undefined : tag,
			status: statusFilter === '__all' ? undefined : (statusFilter as 'active' | 'inactive'),
			planId: planFilter === '__all' ? undefined : planFilter === '__none' ? 'none' : planFilter,
			sort,
			owes: owesFilter === 'owes' || undefined
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

	// ------- challenges -------
	const challenges = $derived(await getChallenges());
	let chalOpen = $state(false);
	let cName = $state('');
	let cDesc = $state('');
	let cGoal = $state(30);
	let cPrize = $state('');
	let cStart = $state(new Date().toISOString().slice(0, 10));
	let cEnd = $state('');
	let cPending = $state(false);

	async function submitChallenge(e: SubmitEvent) {
		e.preventDefault();
		cPending = true;
		try {
			await createChallenge({
				name: cName.trim(),
				description: cDesc.trim() || undefined,
				prize: cPrize.trim() || undefined,
				goal: cGoal,
				startDate: cStart,
				endDate: cEnd
			});
			toast.success('Challenge created — members can join in the portal');
			cName = cDesc = cPrize = '';
			await getChallenges().refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not create challenge'));
		}
		cPending = false;
	}

	async function toggleChallenge(id: string, active: boolean) {
		try {
			await updateChallenge({ id, active });
			await getChallenges().refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
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
	let emailSendAt = $state('');
	let emailPending = $state(false);
	const audTag = $derived(emailAudience.startsWith('tag:') ? emailAudience.slice(4) : undefined);
	const audPlan = $derived(emailAudience.startsWith('plan:') ? emailAudience.slice(5) : undefined);
	const audPlanName = $derived(
		audPlan ? (audiencePlans.find((p) => p.id === audPlan)?.name ?? 'plan') : ''
	);
	const audLabel = $derived(
		emailAudience === '__sel'
			? `Selected members (${selected.size})`
			: emailAudience === '__all'
				? 'All active members'
				: audTag
					? `Tag: ${audTag}`
					: `Plan: ${audPlanName}`
	);
	const audienceCount = $derived(
		emailAudience === '__sel'
			? selected.size
			: emailOpen
				? await getAnnouncementAudience({ tag: audTag, planId: audPlan })
				: null
	);
	async function submitAnnouncement(e: SubmitEvent) {
		e.preventDefault();
		emailPending = true;
		try {
			if (emailSendAt && emailAudience !== '__sel') {
				await scheduleEmail({
					subject: emailSubject,
					message: emailBody,
					tag: audTag,
					planId: audPlan,
					sendAt: new Date(emailSendAt).toISOString()
				});
				toast.success('Scheduled — the daily job sends it');
			} else {
				const r = await emailAllMembers({
					subject: emailSubject,
					message: emailBody,
					tag: audTag,
					planId: audPlan,
					memberIds: emailAudience === '__sel' ? [...selected] : undefined
				});
				toast.success(r.total ? `Sent to ${r.sent} of ${r.total} members` : 'No members to email');
			}
			emailOpen = false;
			emailSubject = emailBody = emailSendAt = '';
			emailAudience = '__all';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send — try again'));
		}
		emailPending = false;
	}
	async function cancelScheduled(id: string) {
		try {
			await cancelScheduledEmail(id);
			toast.success('Scheduled email cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
	}
	let testPending = $state(false);
	// ------- AI draft (Enterprise) -------
	let aiDraftOpen = $state(false);
	let aiGoal = $state('');
	let aiPending = $state(false);
	async function runAiDraft() {
		aiPending = true;
		try {
			const r = await aiDraftEmail({
				goal: aiGoal,
				audience: emailAudience === '__sel' ? `${selected.size} selected members` : audLabel
			});
			emailSubject = r.subject;
			emailBody = r.body;
			aiDraftOpen = false;
			toast.success('Draft ready — review before sending');
		} catch (err) {
			toast.error(errMsg(err, 'AI draft failed'));
		}
		aiPending = false;
	}
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
		<Button
			size="sm"
			variant="outline"
			onclick={() => {
				emailAudience = selected.size ? '__sel' : '__all';
				emailOpen = true;
			}}><Mail /> Email</Button
		>
		<Button size="sm" variant="outline" onclick={() => (chalOpen = true)}
			><Trophy /> Challenges</Button
		>
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
		{#if audiencePlans.length}
			<Select.Root type="single" bind:value={planFilter} onValueChange={() => void refilter()}>
				<Select.Trigger class="w-40"
					>{planFilter === '__all'
						? 'All plans'
						: planFilter === '__none'
							? 'No plan'
							: (audiencePlans.find((p) => p.id === planFilter)?.name ?? 'Plan')}</Select.Trigger
				>
				<Select.Content>
					<Select.Item value="__all">All plans</Select.Item>
					<Select.Item value="__none">No plan</Select.Item>
					{#each audiencePlans as p (p.id)}
						<Select.Item value={p.id}>{p.name}</Select.Item>
					{/each}
				</Select.Content>
			</Select.Root>
		{/if}
		<Select.Root type="single" bind:value={owesFilter} onValueChange={() => void refilter()}>
			<Select.Trigger class="w-36"
				>{owesFilter === 'owes' ? 'Owes money' : 'Any balance'}</Select.Trigger
			>
			<Select.Content>
				<Select.Item value="any">Any balance</Select.Item>
				<Select.Item value="owes">Owes money</Select.Item>
			</Select.Content>
		</Select.Root>
		<Select.Root type="single" bind:value={sort} onValueChange={() => void refilter()}>
			<Select.Trigger class="w-36">{SORT_LABELS[sort]}</Select.Trigger>
			<Select.Content>
				{#each Object.entries(SORT_LABELS) as [value, label] (value)}
					<Select.Item {value}>{label}</Select.Item>
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	{#if dupes.length}
		<div
			class="flex flex-col gap-1 rounded-md border border-amber-300/60 bg-amber-50 px-3 py-2 text-sm dark:border-amber-900 dark:bg-amber-950/40"
		>
			<span class="font-medium"
				>{dupes.length} possible duplicate{dupes.length === 1 ? '' : 's'} — open a member to merge</span
			>
			{#each dupes as d (d.reason)}
				<span class="text-muted-foreground"
					>{d.reason}:
					{#each d.members as m, i (m.id)}{#if i},&nbsp;{/if}<a
							class="underline underline-offset-2 hover:text-foreground"
							href="/members/{m.id}">{m.name}</a
						>{/each}</span
				>
			{/each}
		</div>
	{/if}

	{#if selected.size}
		<div class="flex items-center gap-3 rounded-md border bg-muted/40 px-3 py-2 text-sm">
			<span class="font-medium tabular-nums">{selected.size} selected</span>
			<Button size="sm" variant="outline" onclick={() => (tagOpen = true)}><TagIcon /> Tag</Button>
			<Button size="sm" variant="ghost" onclick={() => selected.clear()}>Clear</Button>
		</div>
	{/if}

	<Card.Root class="py-0">
		<Card.Content class="px-0">
			<Table.Root>
				<Table.Header>
					<Table.Row>
						<Table.Head class="w-8">
							<input
								type="checkbox"
								class="accent-primary"
								aria-label="Select all"
								checked={members.length > 0 && selected.size === members.length}
								onchange={toggleAll}
							/>
						</Table.Head>
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
							<Table.Cell onclick={(e) => e.stopPropagation()}>
								<input
									type="checkbox"
									class="accent-primary"
									aria-label={`Select ${m.name}`}
									checked={selected.has(m.id)}
									onchange={() => toggleSelect(m.id)}
								/>
							</Table.Cell>
							<Table.Cell class="font-medium">
								<span class="flex items-center gap-2.5">
									{#if m.photoDocumentId}
										<img
											src="/api/documents/{m.photoDocumentId}"
											alt=""
											class="size-8 shrink-0 rounded-full object-cover"
										/>
									{:else}
										<span
											class="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
											>{initials(m.name)}</span
										>
									{/if}
									{m.name}
								</span>
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
							<Table.Cell colspan={7}>
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

<Dialog.Root bind:open={tagOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Tag {selected.size} member{selected.size === 1 ? '' : 's'}</Dialog.Title>
			<Dialog.Description>
				The tag is added to every selected member — existing tags are kept.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={applyBulkTag}>
			<Field.Field>
				<Field.Label for="bulk-tag">Tag</Field.Label>
				<Input id="bulk-tag" bind:value={bulkTag} list="member-bulk-tags" required />
				<datalist id="member-bulk-tags">
					{#each allTags as t (t)}
						<option value={t}></option>
					{/each}
				</datalist>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={tagPending}>
					{tagPending ? 'Tagging…' : 'Add tag'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

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
		{#if ai.licensed}
			<div class="rounded-md border bg-muted/40 p-3">
				{#if ai.configured}
					{#if aiDraftOpen}
						<div class="flex items-center gap-2">
							<Input bind:value={aiGoal} placeholder="e.g. Closed July 4, reopen Monday" />
							<Button
								type="button"
								size="sm"
								disabled={aiPending || !aiGoal.trim()}
								onclick={runAiDraft}>{aiPending ? 'Drafting…' : 'Draft'}</Button
							>
							<Button type="button" variant="ghost" size="sm" onclick={() => (aiDraftOpen = false)}
								>Cancel</Button
							>
						</div>
						<p class="mt-1.5 text-xs text-muted-foreground">
							Describe the announcement — AI writes the subject + body for review.
						</p>
					{:else}
						<button
							type="button"
							class="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
							onclick={() => (aiDraftOpen = true)}
							><Sparkles class="size-3.5" /> Draft with AI</button
						>
					{/if}
				{:else}
					<p class="text-xs text-muted-foreground">
						AI drafting is available — set FREEWEIGHT_AI_PROVIDER/_MODEL/_KEY on the server to
						enable it.
					</p>
				{/if}
			</div>
		{/if}
		{#if announcements.length}
			<div class="rounded-md border bg-muted/40 p-3 text-sm">
				<p class="mb-2 font-medium text-muted-foreground">Recently sent</p>
				<ul class="space-y-1.5">
					{#each announcements as a (a.id)}
						<li class="flex items-baseline justify-between gap-3">
							<span class="truncate">{a.subject}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								{#if a.action === 'scheduled'}
									Sends {new Date(a.sendAt!).toLocaleString()}
									<button class="ml-1 underline" onclick={() => cancelScheduled(a.id)}
										>cancel</button
									>
								{:else}
									{formatDate(a.createdAt)} · {a.sent} sent{a.tag ? ` · tag: ${a.tag}` : ''}{a.plan
										? ` · plan: ${a.plan}`
										: ''}
								{/if}
							</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}
		<form class="space-y-4" onsubmit={submitAnnouncement}>
			{#if allTags.length || audiencePlans.length || selected.size}
				<Field.Field>
					<Field.Label for="a-audience">Audience</Field.Label>
					<Select.Root type="single" bind:value={emailAudience}>
						<Select.Trigger id="a-audience" class="w-full">
							{audLabel}
						</Select.Trigger>
						<Select.Content>
							{#if selected.size}
								<Select.Item value="__sel">Selected members ({selected.size})</Select.Item>
							{/if}
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
			{#if emailAudience !== '__sel'}
				<Field.Field>
					<Field.Label for="a-sendat">Send at (optional)</Field.Label>
					<Input id="a-sendat" type="datetime-local" bind:value={emailSendAt} />
					<Field.Description>Leave blank to send right away.</Field.Description>
				</Field.Field>
			{/if}
			<Field.Field>
				<Field.Label for="a-body">Message</Field.Label>
				<Textarea
					id="a-body"
					required
					bind:value={emailBody}
					rows={6}
					placeholder={"Hi {first_name} — we're closed this Thursday for maintenance…"}
				/>
				<Field.Description>
					Personalize with {'{name}'} or {'{first_name}'}.
				</Field.Description>
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
							: emailSendAt && emailAudience !== '__sel'
								? 'Schedule'
								: emailAudience === '__all'
									? 'Send to all members'
									: emailAudience === '__sel'
										? `Send to ${selected.size} selected`
										: `Send to ${audLabel.replace(/^(Tag|Plan): /, '')}`}
					</Button>
				</div></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={chalOpen}>
	<Dialog.Content class="sm:max-w-xl">
		<Dialog.Header>
			<Dialog.Title>Challenges</Dialog.Title>
			<Dialog.Description>
				Members join in the portal — progress counts their check-ins inside the window.
			</Dialog.Description>
		</Dialog.Header>
		{#if challenges.length}
			<div class="mb-4 space-y-3">
				{#each challenges as c (c.challenge.id)}
					<div class="rounded-lg border p-3">
						<div class="flex items-center justify-between gap-2">
							<div class="min-w-0">
								<span class="font-medium">{c.challenge.name}</span>
								<Badge
									variant={c.state === 'live' ? 'default' : 'secondary'}
									class="ml-2 align-middle">{c.state}</Badge
								>
								<p class="text-xs text-muted-foreground">
									{formatDate(c.challenge.startDate)} → {formatDate(c.challenge.endDate)} ·
									{c.challenge.goal} check-ins · {c.joined} joined · {c.finished}
									finished{c.challenge.prize ? ` · prize: ${c.challenge.prize}` : ''}
								</p>
							</div>
							<Switch
								checked={c.challenge.active}
								onCheckedChange={(v) => toggleChallenge(c.challenge.id, v)}
							/>
						</div>
						{#if c.entries.length}
							<div class="mt-2 space-y-0.5 text-sm">
								{#each c.entries.slice(0, 5) as e, i (e.entry.id)}
									<div class="flex justify-between gap-2">
										<span class="truncate text-muted-foreground">
											{i + 1}. {e.memberName}
										</span>
										<span class="tabular-nums">{e.count}/{c.challenge.goal}</span>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
		<form class="space-y-4" onsubmit={submitChallenge}>
			<Field.Field>
				<Field.Label for="c-name">Name</Field.Label>
				<Input id="c-name" required bind:value={cName} placeholder="30 visits in 30 days" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="c-desc">Description (optional)</Field.Label>
				<Input id="c-desc" bind:value={cDesc} placeholder="Check in 30 times this month" />
			</Field.Field>
			<Field.Field>
				<Field.Label for="c-prize">Prize (optional)</Field.Label>
				<Input id="c-prize" bind:value={cPrize} placeholder="A free month, gym hoodie…" />
			</Field.Field>
			<div class="grid grid-cols-3 gap-3">
				<Field.Field>
					<Field.Label for="c-goal">Goal (check-ins)</Field.Label>
					<Input id="c-goal" type="number" min={1} max={1000} required bind:value={cGoal} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="c-start">Starts</Field.Label>
					<Input id="c-start" type="date" required bind:value={cStart} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="c-end">Ends</Field.Label>
					<Input id="c-end" type="date" required bind:value={cEnd} />
				</Field.Field>
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={cPending || !cName.trim() || !cEnd}
					>{cPending ? 'Creating…' : 'Create challenge'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
