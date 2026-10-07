<script lang="ts">
	import { page } from '$app/state';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getMember,
		updateMember,
		getPortalInvite,
		recordCheckIn,
		logGuestVisit,
		getMemberNotes,
		addMemberNote,
		deleteMemberNote,
		getTags,
		addMemberTag,
		removeMemberTag
	} from '#lib/remote/members.remote.ts';
	import {
		getPlans,
		createMembership,
		updateMembership,
		recordPayment,
		refundPayment,
		getCurrency
	} from '#lib/remote/billing.remote.ts';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localTime, localDate } from '#lib/tz.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { getMemberDocuments, deleteDocument } from '#lib/remote/documents.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Link from '@lucide/svelte/icons/link';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Upload from '@lucide/svelte/icons/upload';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import FileText from '@lucide/svelte/icons/file-text';
	import { paymentMethods } from '#lib/schemas.ts';

	const id = page.params.id!;
	const m = $derived(await getMember(id));
	const memberNotes = $derived(await getMemberNotes(id));
	let noteBody = $state('');
	let notePending = $state(false);
	async function addNote() {
		notePending = true;
		try {
			await addMemberNote({ memberId: id, body: noteBody.trim() });
			noteBody = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add note'));
		}
		notePending = false;
	}
	async function removeNote(noteId: string) {
		try {
			await deleteMemberNote({ noteId, memberId: id });
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete note'));
		}
	}

	// ------- tags -------
	const allTags = $derived(await getTags());
	let newTag = $state('');
	async function addTag() {
		const t = newTag.trim();
		if (!t) return;
		try {
			await addMemberTag({ memberId: id, tag: t });
			newTag = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add tag'));
		}
	}
	async function removeTag(tag: string) {
		try {
			await removeMemberTag({ memberId: id, tag });
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove tag'));
		}
	}
	const plans = $derived(await getPlans());
	const settings = $derived(await getSettings());
	const currency = $derived(await getCurrency());
	const tz = settings.timezone;

	const balance = $derived(
		m.charges
			.filter((c) => c.charge.status === 'open')
			.reduce((sum, c) => sum + c.charge.amount - c.paid, 0)
	);

	// ------- documents -------
	const docs = $derived(await getMemberDocuments(id));
	let uploading = $state(false);
	let fileInput = $state<HTMLInputElement>();
	const fileSize = (n: number) =>
		n < 1024
			? `${n} B`
			: n < 1048576
				? `${(n / 1024).toFixed(0)} KB`
				: `${(n / 1048576).toFixed(1)} MB`;
	async function uploadFiles(files: FileList | null | undefined) {
		if (!files?.length) return;
		uploading = true;
		const body = new FormData();
		for (const f of files) body.append('file', f);
		body.append('entityType', 'member');
		body.append('entityId', id);
		const res = await fetch('/api/documents', { method: 'POST', body });
		uploading = false;
		if (!res.ok) {
			toast.error((await res.json().catch(() => null))?.message ?? 'Upload failed');
			return;
		}
		toast.success(files.length === 1 ? 'File uploaded' : `${files.length} files uploaded`);
		await getMemberDocuments(id).refresh();
		if (fileInput) fileInput.value = '';
	}
	async function removeDoc(docId: string, docName: string) {
		if (!confirm(`Delete ${docName}?`)) return;
		try {
			await deleteDocument(docId);
			await getMemberDocuments(id).refresh();
		} catch {
			toast.error('Could not delete');
		}
	}

	async function refund(paymentId: string, amount: number) {
		if (!confirm(`Refund ${formatMoney(amount, currency)}? The charge it covered reopens.`)) return;
		try {
			await refundPayment(paymentId);
			toast.success('Payment refunded');
		} catch (err) {
			toast.error(errMsg(err, 'Could not refund'));
		}
	}

	// ------- edit member -------
	let editOpen = $state(false);
	let name = $state(m.member.name);
	let email = $state(m.member.email ?? '');
	let phone = $state(m.member.phone ?? '');
	let status = $state<'active' | 'inactive'>(m.member.status);
	let birthday = $state(m.member.birthday ?? '');
	let pending = $state(false);
	async function saveMember(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await updateMember({
				id,
				name,
				email: email || undefined,
				phone: phone || undefined,
				status,
				birthday: birthday || null
			});
			toast.success('Member updated');
			editOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Update failed'));
		}
		pending = false;
	}

	// ------- membership -------
	let memOpen = $state(false);
	let planId = $state('');
	let startsAt = $state(new Date().toISOString().slice(0, 10));
	async function addMembership(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createMembership({ memberId: id, planId, startsAt });
			toast.success('Membership started — signup and first-period charges posted');
			memOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not start membership'));
		}
		pending = false;
	}

	async function setMembership(
		membershipId: string,
		status: 'paused' | 'cancelled' | 'suspended' | 'active',
		resumeAt?: string
	) {
		try {
			await updateMembership({ id: membershipId, status, resumeAt: resumeAt || null });
			toast.success(`Membership ${status}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	async function dismissCancelRequest(membershipId: string) {
		try {
			await updateMembership({ id: membershipId, clearCancelRequest: true });
			toast.success('Request dismissed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not dismiss'));
		}
	}

	async function dismissPauseRequest(membershipId: string) {
		try {
			await updateMembership({ id: membershipId, clearPauseRequest: true });
			toast.success('Request dismissed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not dismiss'));
		}
	}

	let pauseOpen = $state(false);
	let pauseId = $state('');
	let pauseResumeAt = $state('');
	async function submitPause(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		await setMembership(pauseId, 'paused', pauseResumeAt || undefined);
		pending = false;
		pauseOpen = false;
		pauseResumeAt = '';
	}

	// ------- guest visit -------
	let guestOpen = $state(false);
	let guestName = $state('');
	async function logGuest(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const r = await logGuestVisit({ memberId: id, guestName });
			toast.success(`${guestName} checked in as a guest (${r.used}/${r.cap} used)`);
			guestOpen = false;
			guestName = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not log guest'));
		}
		pending = false;
	}

	// ------- payment -------
	let payOpen = $state(false);
	let payAmount = $state<number | null>(null);
	let method = $state<'card' | 'cash' | 'bank' | 'other'>('cash');
	let notes = $state('');
	async function submitPayment(e: SubmitEvent) {
		e.preventDefault();
		if (!payAmount) return;
		pending = true;
		try {
			await recordPayment({ memberId: id, amount: payAmount, method, notes: notes || undefined });
			toast.success('Payment recorded');
			payOpen = false;
			payAmount = null;
			notes = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not record payment'));
		}
		pending = false;
	}

	// ------- portal invite -------
	async function copyPortalLink() {
		try {
			const { url } = await getPortalInvite(id);
			await navigator.clipboard.writeText(url);
			toast.success('Portal link copied — valid 14 days');
		} catch (err) {
			toast.error(errMsg(err, 'Could not create link'));
		}
	}
	async function manualCheckIn() {
		try {
			await recordCheckIn({ code: id });
			toast.success(`${m.member.name} checked in`);
		} catch (err) {
			toast.error(errMsg(err, 'Check-in failed'));
		}
	}
</script>

<PageHeader title={m.member.name} crumbs={[{ label: 'Members', href: '/members' }]}>
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={manualCheckIn}><ScanLine /> Check in</Button>
		<Button variant="outline" size="sm" onclick={copyPortalLink}><Link /> Portal link</Button>
		<Button variant="outline" size="sm" onclick={() => (guestOpen = true)}
			><UserPlus /> Guest</Button
		>
		<Button size="sm" variant="outline" onclick={() => (editOpen = true)}>Edit</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-3">
	<div class="space-y-6 lg:col-span-1">
		<Card.Root>
			<Card.Header><Card.Title class="text-base">Details</Card.Title></Card.Header>
			<Card.Content class="space-y-2 text-sm">
				<div class="flex justify-between">
					<span class="text-muted-foreground">Status</span><StatusBadge status={m.member.status} />
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Email</span><span class="truncate"
						>{m.member.email ?? '—'}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Phone</span><span>{m.member.phone ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Location</span><span>{m.locationName ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Joined</span><span
						>{formatDate(m.member.joinedAt)}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Source</span><span
						>{m.member.referralSource ?? '—'}</span
					>
				</div>
				{#if m.referredBy || m.referralCount}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Referrals</span>
						<span class="text-right">
							{#if m.referredBy}
								Joined via <a class="underline" href="/members/{m.referredBy.id}"
									>{m.referredBy.name}</a
								>{m.referralCount ? ' · ' : ''}
							{/if}
							{#if m.referralCount}referred {m.referralCount}{/if}
						</span>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Birthday</span><span
						>{m.member.birthday ? formatDate(m.member.birthday) : '—'}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Waiver</span>
					<span
						>{m.signedWaiver ? `Signed ${formatDate(m.signedWaiver.signedAt)}` : 'Not signed'}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Guest passes</span>
					<span
						>{m.guestPasses
							? `${m.guestsUsed}/${m.guestPasses} used this month`
							: 'None on this plan'}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Open balance</span>
					<span class="font-medium tabular-nums">{formatMoney(balance, currency)}</span>
				</div>
				<div class="flex items-start justify-between gap-2">
					<span class="pt-0.5 text-muted-foreground">Tags</span>
					<span class="flex max-w-56 flex-wrap justify-end gap-1">
						{#each m.tags as t (t)}
							<Badge variant="secondary" class="gap-1">
								{t}
								<button
									class="text-muted-foreground hover:text-foreground"
									onclick={() => removeTag(t)}
									aria-label="Remove tag {t}">×</button
								>
							</Badge>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/each}
						<input
							bind:value={newTag}
							list="member-tag-options"
							placeholder="+ tag"
							class="w-16 border-0 bg-transparent p-0 text-right text-sm outline-none placeholder:text-muted-foreground"
							onkeydown={(e) => e.key === 'Enter' && void addTag()}
						/>
						<datalist id="member-tag-options">
							{#each allTags as t (t)}
								<option value={t}></option>
							{/each}
						</datalist>
					</span>
				</div>
			</Card.Content>
			{#if balance > 0}
				<Card.Footer>
					<Button class="w-full" onclick={() => ((payAmount = balance), (payOpen = true))}
						>Record payment</Button
					>
				</Card.Footer>
			{/if}
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Memberships</Card.Title>
				<Button size="sm" variant="outline" onclick={() => (memOpen = true)}><Plus /> New</Button>
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				{#each m.memberships as mm (mm.membership.id)}
					<div class="flex items-center justify-between gap-2 text-sm">
						<div class="min-w-0">
							<p class="truncate font-medium">{mm.planName}</p>
							<p class="text-xs text-muted-foreground">
								{formatMoney(mm.amount, currency)}{mm.isPack ? ' pack' : `/${mm.interval}`} · from {formatDate(
									mm.membership.startsAt
								)}{mm.membership.endsAt ? ` · expires ${formatDate(mm.membership.endsAt)}` : ''}{mm
									.membership.frozenUntil
									? ` · paused until ${formatDate(mm.membership.frozenUntil)}`
									: ''}
							</p>
							{#if mm.membership.cancelRequestedAt}
								<p class="text-xs text-amber-600 dark:text-amber-400">
									Cancellation requested {formatDate(mm.membership.cancelRequestedAt)}
								</p>
							{/if}
							{#if mm.membership.pauseRequestedAt}
								<p class="text-xs text-amber-600 dark:text-amber-400">
									Pause requested{mm.membership.pauseUntil
										? ` — resume ${formatDate(mm.membership.pauseUntil)}`
										: ''}
								</p>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<StatusBadge status={mm.membership.status} />
							{#if mm.membership.status === 'active'}
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => ((pauseId = mm.membership.id), (pauseOpen = true))}>Pause</Button
								>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-destructive"
									onclick={() => setMembership(mm.membership.id, 'suspended')}>Suspend</Button
								>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-destructive"
									onclick={() => setMembership(mm.membership.id, 'cancelled')}>Cancel</Button
								>
								{#if mm.membership.pauseRequestedAt}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										onclick={() =>
											setMembership(
												mm.membership.id,
												'paused',
												mm.membership.pauseUntil ?? undefined
											)}>Approve pause</Button
									>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										onclick={() => dismissPauseRequest(mm.membership.id)}>Dismiss</Button
									>
								{:else if mm.membership.cancelRequestedAt}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										onclick={() => dismissCancelRequest(mm.membership.id)}>Dismiss</Button
									>
								{/if}
							{:else if mm.membership.status === 'paused' || mm.membership.status === 'suspended'}
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => setMembership(mm.membership.id, 'active')}>Resume</Button
								>
							{/if}
						</div>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No memberships.</p>
				{/each}
				{#if m.credits}
					<p class="text-xs text-muted-foreground">
						{m.credits.used} of {m.credits.limit} classes used this period
					</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Documents</Card.Title>
				<Button size="sm" variant="outline" disabled={uploading} onclick={() => fileInput?.click()}>
					<Upload />
					{uploading ? 'Uploading…' : 'Upload'}
				</Button>
				<input
					bind:this={fileInput}
					type="file"
					multiple
					class="hidden"
					onchange={(e) => uploadFiles(e.currentTarget.files)}
				/>
			</Card.Header>
			<Card.Content class="px-4">
				{#each docs as doc (doc.id)}
					<div class="flex items-center justify-between gap-2 py-1.5 text-sm">
						<a
							href="/api/documents/{doc.id}"
							target="_blank"
							class="flex min-w-0 items-center gap-2 hover:underline"
						>
							<FileText class="size-4 shrink-0 text-muted-foreground" />
							<span class="truncate">{doc.name}</span>
						</a>
						<div class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">
							<span>{fileSize(doc.size)} · {formatRelative(doc.createdAt)}</span>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 px-1.5 text-destructive"
								onclick={() => removeDoc(doc.id, doc.name)}
								aria-label="Delete {doc.name}"><Trash2 class="size-3.5" /></Button
							>
						</div>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						No documents yet — upload contracts, forms, or notes. Members can see these in their
						portal.
					</p>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Notes</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				{#each memberNotes as n (n.id)}
					<div class="flex items-start justify-between gap-2 text-sm">
						<div class="min-w-0">
							<p class="break-words whitespace-pre-wrap">{n.body}</p>
							<p class="text-xs text-muted-foreground">
								{n.authorName ?? 'Staff'} · {formatRelative(n.createdAt)}
							</p>
						</div>
						<Button
							variant="ghost"
							size="sm"
							class="h-7 shrink-0 px-1.5 text-destructive"
							onclick={() => removeNote(n.id)}
							aria-label="Delete note"><Trash2 class="size-3.5" /></Button
						>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						No notes yet — staff-only; the member can't see these.
					</p>
				{/each}
				<form
					class="space-y-2 border-t pt-3"
					onsubmit={(e) => {
						e.preventDefault();
						void addNote();
					}}
				>
					<Textarea bind:value={noteBody} rows={2} placeholder="Add a note…" />
					<Button type="submit" size="sm" disabled={notePending || !noteBody.trim()}>
						{notePending ? 'Saving…' : 'Add note'}
					</Button>
				</form>
			</Card.Content>
		</Card.Root>
	</div>

	<Card.Root class="lg:col-span-2">
		<Tabs.Root value="charges">
			<Card.Header>
				<Tabs.List>
					<Tabs.Trigger value="charges">Charges</Tabs.Trigger>
					<Tabs.Trigger value="payments">Payments</Tabs.Trigger>
					<Tabs.Trigger value="bookings">Bookings</Tabs.Trigger>
					<Tabs.Trigger value="checkins">Check-ins</Tabs.Trigger>
				</Tabs.List>
			</Card.Header>
			<Card.Content class="px-4 pb-4">
				<Tabs.Content value="charges">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Description</Table.Head>
								<Table.Head>Due</Table.Head>
								<Table.Head>Status</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
								<Table.Head class="text-right">Paid</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.charges as c (c.charge.id)}
								<Table.Row>
									<Table.Cell>{c.charge.description ?? c.charge.kind}</Table.Cell>
									<Table.Cell>{formatDate(c.charge.dueDate)}</Table.Cell>
									<Table.Cell><StatusBadge status={c.charge.status} /></Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(c.charge.amount, currency)}</Table.Cell
									>
									<Table.Cell class="text-right text-muted-foreground tabular-nums"
										>{formatMoney(c.paid, currency)}</Table.Cell
									>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={5} class="text-muted-foreground">No charges.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
				<Tabs.Content value="payments">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Date</Table.Head>
								<Table.Head>Method</Table.Head>
								<Table.Head class="text-right">Amount</Table.Head>
								<Table.Head></Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.payments as p (p.id)}
								<Table.Row class={p.refundedAt ? 'opacity-50' : ''}>
									<Table.Cell>{formatDate(p.paidAt)}</Table.Cell>
									<Table.Cell class="capitalize">{p.method}</Table.Cell>
									<Table.Cell class="text-right tabular-nums"
										>{formatMoney(p.amount, currency)}</Table.Cell
									>
									<Table.Cell class="text-right">
										{#if p.refundedAt}
											<span class="text-xs text-muted-foreground"
												>refunded {formatDate(p.refundedAt)}</span
											>
										{:else}
											<Button
												variant="ghost"
												size="sm"
												class="h-7 px-2 text-xs"
												onclick={() => refund(p.id, p.amount)}>Refund</Button
											>
										{/if}
									</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={4} class="text-muted-foreground">No payments.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
				<Tabs.Content value="bookings">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Class</Table.Head>
								<Table.Head>When</Table.Head>
								<Table.Head>Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.bookings as b (b.booking.id)}
								<Table.Row>
									<Table.Cell>{b.className}</Table.Cell>
									<Table.Cell class="text-muted-foreground"
										>{localDate(b.startsAt, tz)} {localTime(b.startsAt, tz)}</Table.Cell
									>
									<Table.Cell><StatusBadge status={b.booking.status} /></Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={3} class="text-muted-foreground">No bookings.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
				<Tabs.Content value="checkins">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>When</Table.Head>
								<Table.Head>Method</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each m.checkIns as c (c.id)}
								<Table.Row>
									<Table.Cell class="text-muted-foreground"
										>{localDate(c.checkedAt, tz)} {localTime(c.checkedAt, tz)}</Table.Cell
									>
									<Table.Cell class="uppercase">{c.method}</Table.Cell>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={3} class="text-muted-foreground">No check-ins.</Table.Cell
									></Table.Row
								>
							{/each}
						</Table.Body>
					</Table.Root>
				</Tabs.Content>
			</Card.Content>
		</Tabs.Root>
	</Card.Root>
</div>

<Dialog.Root bind:open={pauseOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Pause membership</Dialog.Title>
			<Dialog.Description>
				The member can't book while paused. Optionally pick a date to resume automatically.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitPause}>
			<Field.Field
				><Field.Label for="pause-until">Resume on (optional)</Field.Label><Input
					id="pause-until"
					type="date"
					bind:value={pauseResumeAt}
				/></Field.Field
			>
			<Dialog.Footer>
				<Button type="submit" disabled={pending}>Pause membership</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={guestOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Log a guest visit</Dialog.Title>
			<Dialog.Description
				>{m.guestPasses
					? `${m.member.name} has ${m.guestPasses - m.guestsUsed} guest passes left this month.`
					: `${m.member.name}'s plan doesn't include guest passes.`}</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={logGuest}>
			<Field.Field
				><Field.Label for="guest-name">Guest name</Field.Label><Input
					id="guest-name"
					required
					bind:value={guestName}
					autofocus
				/></Field.Field
			>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !guestName.trim()}>Check in guest</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={editOpen}>
	<Dialog.Content>
		<Dialog.Header><Dialog.Title>Edit member</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={saveMember}>
			<Field.Field
				><Field.Label for="e-name">Name</Field.Label><Input
					id="e-name"
					required
					bind:value={name}
				/></Field.Field
			>
			<Field.Field
				><Field.Label for="e-email">Email</Field.Label><Input
					id="e-email"
					type="email"
					bind:value={email}
				/></Field.Field
			>
			<Field.Field
				><Field.Label for="e-phone">Phone</Field.Label><Input
					id="e-phone"
					bind:value={phone}
				/></Field.Field
			>
			<Field.Field
				><Field.Label for="e-birthday">Birthday (optional)</Field.Label><Input
					id="e-birthday"
					type="date"
					bind:value={birthday}
				/></Field.Field
			>
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
			<Dialog.Footer><Button type="submit" disabled={pending}>Save</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={memOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>New membership</Dialog.Title>
			<Dialog.Description
				>Posts the signup fee and the first period charge immediately.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={addMembership}>
			<Field.Field>
				<Field.Label>Plan</Field.Label>
				<Select.Root type="single" bind:value={planId}>
					<Select.Trigger class="w-full"
						>{plans.find((p) => p.id === planId)?.name ?? 'Choose a plan'}</Select.Trigger
					>
					<Select.Content>
						{#each plans.filter((p) => p.active) as p (p.id)}
							<Select.Item value={p.id}
								>{p.name} · {formatMoney(p.amount, currency)}/{p.interval}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="m-start">Starts</Field.Label>
				<Input id="m-start" type="date" required bind:value={startsAt} />
			</Field.Field>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !planId}>Start membership</Button
				></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={payOpen}>
	<Dialog.Content>
		<Dialog.Header><Dialog.Title>Record payment</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={submitPayment}>
			<Field.Field>
				<Field.Label>Amount</Field.Label>
				<MoneyInput bind:value={payAmount} />
			</Field.Field>
			<Field.Field>
				<Field.Label>Method</Field.Label>
				<Select.Root type="single" bind:value={method}>
					<Select.Trigger class="w-full">{method}</Select.Trigger>
					<Select.Content>
						{#each paymentMethods.filter((pm) => pm !== 'stripe') as pm (pm)}
							<Select.Item value={pm}>{pm}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field
				><Field.Label for="pay-notes">Note</Field.Label><Input
					id="pay-notes"
					bind:value={notes}
				/></Field.Field
			>
			<Dialog.Footer
				><Button type="submit" disabled={pending || !payAmount}>Record</Button></Dialog.Footer
			>
		</form>
	</Dialog.Content>
</Dialog.Root>
