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
		getCheckInCode,
		recordCheckIn,
		logGuestVisit,
		getMemberNotes,
		addMemberNote,
		deleteMemberNote,
		getTags,
		addMemberTag,
		removeMemberTag,
		emailAllMembers,
		requestPayment,
		getMembers,
		mergeMembers
	} from '#lib/remote/members.remote.ts';
	import {
		getPlans,
		createMembership,
		updateMembership,
		recordPayment,
		refundPayment,
		getCurrency,
		grantCredits
	} from '#lib/remote/billing.remote.ts';
	import {
		getClassTypes,
		bookSeries,
		getSessions,
		bookSession
	} from '#lib/remote/schedule.remote.ts';
	import { errMsg, formatDate, formatMoney, formatRelative } from '#lib/format.ts';
	import { localTime, localDate } from '#lib/tz.ts';
	import { getSettings } from '#lib/remote/workspace.remote.ts';
	import { getMemberDocuments, deleteDocument } from '#lib/remote/documents.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Link from '@lucide/svelte/icons/link';
	import Mail from '@lucide/svelte/icons/mail';
	import ScanLine from '@lucide/svelte/icons/scan-line';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Upload from '@lucide/svelte/icons/upload';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import FileText from '@lucide/svelte/icons/file-text';
	import Printer from '@lucide/svelte/icons/printer';
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
	let avatarInput = $state<HTMLInputElement>();
	/** Initials fallback when the member has no photo. */
	const initials = $derived(
		m.member.name
			.split(/\s+/)
			.map((w) => w[0])
			.filter(Boolean)
			.slice(0, 2)
			.join('')
			.toUpperCase()
	);
	async function uploadAvatar(file: File | null | undefined) {
		if (!file) return;
		uploading = true;
		const body = new FormData();
		body.append('file', file);
		body.append('entityType', 'member');
		body.append('entityId', id);
		body.append('avatar', '1');
		const res = await fetch('/api/documents', { method: 'POST', body });
		uploading = false;
		if (!res.ok) {
			toast.error((await res.json().catch(() => null))?.message ?? 'Upload failed');
			return;
		}
		toast.success('Photo updated');
		await getMember(id).refresh();
		if (avatarInput) avatarInput.value = '';
	}
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

	// ------- comp classes -------
	let compOpen = $state(false);
	let compCount = $state(1);
	async function submitComp(e: SubmitEvent) {
		e.preventDefault();
		if (!m.credits?.membershipId) return;
		try {
			await grantCredits({ membershipId: m.credits.membershipId, count: compCount });
			toast.success(`Granted ${compCount} comp class${compCount === 1 ? '' : 'es'}`);
			compOpen = false;
			compCount = 1;
		} catch (err) {
			toast.error(errMsg(err, 'Could not grant'));
		}
	}

	// ------- edit member -------
	let editOpen = $state(false);

	// ------- merge duplicate -------
	let mergeOpen = $state(false);
	let mergeQ = $state('');
	let mergeResults = $state<Awaited<ReturnType<typeof getMembers>>>([]);
	let mergePick = $state('');
	let mergePending = $state(false);
	let mergeTimer: ReturnType<typeof setTimeout> | undefined;
	function searchMerge() {
		clearTimeout(mergeTimer);
		mergeTimer = setTimeout(async () => {
			mergeResults = (await getMembers({ q: mergeQ })).filter((r) => r.id !== id);
		}, 150);
	}
	async function openMerge() {
		mergePick = '';
		mergeQ = '';
		mergeResults = (await getMembers()).filter((r) => r.id !== id);
		mergeOpen = true;
	}
	async function doMerge() {
		mergePending = true;
		try {
			const name = mergeResults.find((r) => r.id === mergePick)?.name ?? 'duplicate';
			await mergeMembers({ keepId: id, dropId: mergePick });
			toast.success(`Merged ${name} into ${m.member.name}`);
			mergeOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not merge'));
		}
		mergePending = false;
	}

	let name = $state(m.member.name);
	let email = $state(m.member.email ?? '');
	let phone = $state(m.member.phone ?? '');
	let status = $state<'active' | 'inactive'>(m.member.status);
	let birthday = $state(m.member.birthday ?? '');
	let deskNote = $state(m.member.deskNote ?? '');
	let guardianId = $state(m.member.guardianId ?? 'none');
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
				birthday: birthday || null,
				deskNote: deskNote || null,
				guardianId: guardianId === 'none' ? null : guardianId
			});
			toast.success('Member updated');
			editOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Update failed'));
		}
		pending = false;
	}

	// ------- email -------
	let emailOpen = $state(false);
	let emailSubject = $state('');
	let emailMessage = $state('');
	async function sendEmailToMember(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const r = await emailAllMembers({
				subject: emailSubject,
				message: emailMessage,
				memberIds: [id]
			});
			toast.success(r.sent ? 'Email sent' : 'Nothing sent — member has no email or unsubscribed');
			emailOpen = false;
			emailSubject = '';
			emailMessage = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send'));
		}
		pending = false;
	}

	// ------- payment request -------
	async function requestPaymentFromMember() {
		pending = true;
		try {
			const sent = await requestPayment(id);
			toast.success(
				sent ? 'Payment request emailed' : 'Not sent — already emailed today or balance is settled'
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not send'));
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

	let planOpen = $state(false);
	let planChangeId = $state('');
	let planChangePlanId = $state('');
	let planChangeCurrent = $state('');
	// Custom recurring price override (cents); null field + prior override = clear.
	let planChangePrice = $state<number | null>(null);
	let planChangeHadPrice = $state(false);
	async function submitPlanChange(e: SubmitEvent) {
		e.preventDefault();
		const price = planChangePrice != null ? planChangePrice : planChangeHadPrice ? null : undefined;
		if (!planChangePlanId && price === undefined) return;
		pending = true;
		try {
			await updateMembership({
				id: planChangeId,
				planId: planChangePlanId || undefined,
				price
			});
			toast.success('Membership updated');
			planOpen = false;
			planChangePlanId = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not update membership'));
		}
		pending = false;
	}
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

	// ------- book into a session -------
	let bookOpen = $state(false);
	let bookSessions = $state<Awaited<ReturnType<typeof getSessions>>>([]);
	let bookPending = $state<string | null>(null);
	/** Upcoming, non-cancelled sessions the member isn't already booked/waitlisted on. */
	const bookable = $derived(
		bookSessions.filter(
			(s) =>
				!s.session.cancelledAt &&
				!m.bookings.some(
					(b) => b.booking.sessionId === s.session.id && b.booking.status !== 'cancelled'
				)
		)
	);
	async function openBook() {
		bookSessions = await getSessions();
		bookOpen = true;
	}
	/** No active membership → the dialog sells paid drop-ins instead of booking. */
	const hasActiveMembership = m.memberships.some((mm) => mm.membership.status === 'active');
	async function bookInto(sessionId: string, dropInPrice?: number | null) {
		bookPending = sessionId;
		try {
			const dropIn = !hasActiveMembership;
			const b = await bookSession({ sessionId, memberId: id, dropIn });
			toast.success(
				dropIn
					? `Drop-in booked — ${formatMoney(dropInPrice ?? 0, currency)} charge posted`
					: b.status === 'waitlisted'
						? 'Class full — waitlisted'
						: 'Booked'
			);
			bookOpen = false;
			await getMember(id).refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		bookPending = null;
	}

	// ------- book series -------
	let seriesOpen = $state(false);
	let seriesTypeId = $state('');
	let seriesWeeks = $state(4);
	let seriesPending = $state(false);
	const classTypes = await getClassTypes();
	async function submitSeries(e: SubmitEvent) {
		e.preventDefault();
		seriesPending = true;
		try {
			const r = await bookSeries({
				memberId: id,
				classTypeId: seriesTypeId,
				weeks: seriesWeeks
			});
			seriesOpen = false;
			await getMember(id).refresh();
			toast.success(
				`Booked ${r.booked}${r.waitlisted ? `, waitlisted ${r.waitlisted}` : ''}${r.skipped ? `, skipped ${r.skipped}` : ''} of ${r.total}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		} finally {
			seriesPending = false;
		}
	}

	// ------- member card -------
	let cardOpen = $state(false);
	let cardQr = $state('');
	async function openCard() {
		cardOpen = true;
		if (cardQr) return;
		try {
			const code = await getCheckInCode(id);
			const QRCode = (await import('qrcode')).default;
			cardQr = await QRCode.toDataURL(code, { width: 220, margin: 1 });
		} catch (err) {
			toast.error(errMsg(err, 'Could not load card'));
		}
	}
</script>

<PageHeader title={m.member.name} crumbs={[{ label: 'Members', href: '/members' }]}>
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={manualCheckIn}><ScanLine /> Check in</Button>
		<Button variant="outline" size="sm" onclick={openCard}><Printer /> Card</Button>
		<Button variant="outline" size="sm" onclick={copyPortalLink}><Link /> Portal link</Button>
		{#if m.member.email}
			<Button variant="outline" size="sm" onclick={() => (emailOpen = true)}><Mail /> Email</Button>
		{/if}
		<Button variant="outline" size="sm" onclick={() => (guestOpen = true)}
			><UserPlus /> Guest</Button
		>
		<Button size="sm" variant="outline" onclick={() => (editOpen = true)}>Edit</Button>
		<Button size="sm" variant="ghost" onclick={openMerge}>Merge…</Button>
	{/snippet}
</PageHeader>

<div class="grid gap-6 p-4 md:p-6 lg:grid-cols-3">
	<div class="space-y-6 lg:col-span-1">
		<Card.Root>
			<Card.Header class="flex-row items-center gap-3">
				<button
					type="button"
					class="relative shrink-0"
					title="Change photo"
					disabled={uploading}
					onclick={() => avatarInput?.click()}
				>
					{#if m.member.photoDocumentId}
						<img
							src="/api/documents/{m.member.photoDocumentId}"
							alt={m.member.name}
							class="size-12 rounded-full object-cover"
						/>
					{:else}
						<span
							class="flex size-12 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground"
							>{initials}</span
						>
					{/if}
				</button>
				<input
					bind:this={avatarInput}
					type="file"
					accept="image/*"
					class="hidden"
					onchange={(e) => uploadAvatar(e.currentTarget.files?.[0])}
				/>
				<Card.Title class="text-base">Details</Card.Title>
			</Card.Header>
			<Card.Content class="space-y-2 text-sm">
				{#if m.member.deskNote}
					<div
						class="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1.5 text-amber-700 dark:text-amber-400"
					>
						{m.member.deskNote}
					</div>
				{/if}
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
					{#if m.signedWaiver && settings.waiver && m.signedWaiver.text !== settings.waiver}
						<span class="text-amber-600"
							>Signed older version {formatDate(m.signedWaiver.signedAt)}</span
						>
					{:else}
						<span
							>{m.signedWaiver
								? `Signed ${formatDate(m.signedWaiver.signedAt)}`
								: 'Not signed'}</span
						>
					{/if}
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Guest passes</span>
					<span
						>{m.guestPasses
							? `${m.guestsUsed}/${m.guestPasses} used this month`
							: 'None on this plan'}</span
					>
				</div>
				{#if m.guardian}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Billed under</span>
						<a class="underline" href="/members/{m.guardian.id}">{m.guardian.name}</a>
					</div>
				{/if}
				{#if m.dependents.length}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Dependents</span>
						<span class="text-right">
							{#each m.dependents as dep, i (dep.id)}
								{#if i},
								{/if}<a class="underline" href="/members/{dep.id}">{dep.name}</a>
							{/each}
						</span>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Visits</span>
					<span class="tabular-nums"
						>{m.attendance.thisMonth} this month · {m.attendance.visits} total</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">No-shows</span>
					<span class="tabular-nums"
						>{m.attendance.noShows}{m.attendance.showRate != null
							? ` · ${m.attendance.showRate}% show rate`
							: ''}</span
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
				<Card.Footer class="flex-col gap-2">
					<Button class="w-full" onclick={() => ((payAmount = balance), (payOpen = true))}
						>Record payment</Button
					>
					{#if m.member.email}
						<Button
							class="w-full"
							variant="outline"
							disabled={pending}
							onclick={requestPaymentFromMember}>Email payment request</Button
						>
					{/if}
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
								{formatMoney(mm.membership.price ?? mm.amount, currency)}{mm.isPack
									? ' pack'
									: `/${mm.interval}`}{mm.membership.price != null ? ' (custom)' : ''} · from {formatDate(
									mm.membership.startsAt
								)}{mm.membership.endsAt ? ` · expires ${formatDate(mm.membership.endsAt)}` : ''}{mm
									.membership.frozenUntil
									? ` · paused until ${formatDate(mm.membership.frozenUntil)}`
									: ''}
							</p>
							{#if mm.membership.cancelRequestedAt}
								<p class="text-xs text-amber-600 dark:text-amber-400">
									Cancellation requested {formatDate(mm.membership.cancelRequestedAt)}{mm.membership
										.requestReason
										? ` — “${mm.membership.requestReason}”`
										: ''}
								</p>
							{/if}
							{#if mm.membership.pauseRequestedAt}
								<p class="text-xs text-amber-600 dark:text-amber-400">
									Pause requested{mm.membership.pauseUntil
										? ` — resume ${formatDate(mm.membership.pauseUntil)}`
										: ''}{mm.membership.requestReason ? ` — “${mm.membership.requestReason}”` : ''}
								</p>
							{/if}
							{#if mm.membership.endReason && mm.membership.status !== 'active'}
								<p class="text-xs text-muted-foreground">“{mm.membership.endReason}”</p>
							{/if}
						</div>
						<div class="flex items-center gap-2">
							<StatusBadge status={mm.membership.status} />
							{#if mm.membership.status === 'active'}
								{#if !mm.isPack}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										onclick={() => (
											(planChangeId = mm.membership.id),
											(planChangeCurrent = mm.membership.planId),
											(planChangePlanId = ''),
											(planChangePrice = mm.membership.price),
											(planChangeHadPrice = mm.membership.price != null),
											(planOpen = true)
										)}>Plan</Button
									>
								{/if}
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
					<div class="flex items-center justify-between">
						<p class="text-xs text-muted-foreground">
							{m.credits.used} of {m.credits.limit} classes used this period{m.credits.bonus
								? ` (+${m.credits.bonus} comp)`
								: ''}
						</p>
						<Button
							variant="ghost"
							size="sm"
							class="h-6 px-2 text-xs"
							onclick={() => (compOpen = true)}>Grant comp classes</Button
						>
					</div>
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

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Progress</Card.Title>
				<Card.Description>Measurements the member logged in the portal</Card.Description>
			</Card.Header>
			<Card.Content class="px-4">
				{#each m.measurements as e (e.id)}
					<div class="flex items-baseline gap-2 py-1 text-sm">
						<span class="w-16 shrink-0 text-xs text-muted-foreground capitalize"
							>{e.kind.replaceAll('_', ' ')}</span
						>
						<span class="font-medium tabular-nums">{e.value} {e.unit}</span>
						<span class="ml-auto shrink-0 text-xs text-muted-foreground">{e.recordedAt}</span>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						Nothing logged yet — members add these in the portal.
					</p>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Emails sent</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#each m.emails as e (e.createdAt + e.kind)}
					<div class="flex items-center justify-between gap-2 py-1 text-sm">
						<span class="capitalize">{e.kind.replaceAll('_', ' ')}</span>
						<span class="shrink-0 text-xs text-muted-foreground">{formatRelative(e.createdAt)}</span
						>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						{m.member.email
							? 'No system emails logged for this address yet.'
							: 'No email on file — member gets no mail.'}
					</p>
				{/each}
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
					<div class="mb-2 flex justify-end gap-2">
						<Button size="sm" variant="outline" onclick={() => void openBook()}>
							Book a class…
						</Button>
						<Button size="sm" variant="outline" onclick={() => (seriesOpen = true)}
							>Book into a series…</Button
						>
					</div>
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

<Dialog.Root bind:open={planOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Change plan or price</Dialog.Title>
			<Dialog.Description>
				Changes apply from the next charge — no proration. Set a custom price to bill this member
				something other than the plan's list price.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitPlanChange}>
			<Field.Field>
				<Field.Label>New plan</Field.Label>
				<Select.Root type="single" bind:value={planChangePlanId}>
					<Select.Trigger class="w-full">
						{plans.find((p) => p.id === planChangePlanId)?.name ?? 'Choose a plan'}
					</Select.Trigger>
					<Select.Content>
						{#each plans.filter((p) => p.active && !p.isPack && p.id !== planChangeCurrent) as p (p.id)}
							<Select.Item value={p.id}
								>{p.name} — {formatMoney(p.amount, currency)}/{p.interval}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>Custom price (optional)</Field.Label>
				<MoneyInput bind:value={planChangePrice} placeholder="Plan price" />
				{#if planChangeHadPrice && planChangePrice == null}
					<p class="text-xs text-muted-foreground">Saving clears the custom price.</p>
				{/if}
			</Field.Field>
			<Dialog.Footer>
				<Button
					type="submit"
					disabled={pending ||
						(!planChangePlanId && planChangePrice == null && !planChangeHadPrice)}>Save</Button
				>
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
			<Field.Field
				><Field.Label for="e-desk">Front-desk flag (optional)</Field.Label><Input
					id="e-desk"
					bind:value={deskNote}
					maxlength={120}
					placeholder="e.g. Owes $50 · Injury: no jumping"
				/><Field.Description>Shown at the kiosk when this member checks in.</Field.Description
				></Field.Field
			>
			<Field.Field>
				<Field.Label>Guardian (household payer)</Field.Label>
				<Select.Root type="single" bind:value={guardianId}>
					<Select.Trigger class="w-full"
						>{guardianId === 'none'
							? 'Bills to this member'
							: (m.memberOptions.find((o) => o.id === guardianId)?.name ??
								'Choose')}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="none">Bills to this member</Select.Item>
						{#each m.memberOptions as o (o.id)}
							<Select.Item value={o.id}>{o.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
				<Field.Description>Their membership charges post under the guardian.</Field.Description>
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

<Dialog.Root bind:open={emailOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Email {m.member.name}</Dialog.Title>
			<Dialog.Description>Goes to {m.member.email}.</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={sendEmailToMember}>
			<Field.Field>
				<Field.Label for="mm-subject">Subject</Field.Label>
				<Input id="mm-subject" required bind:value={emailSubject} autofocus />
			</Field.Field>
			<Field.Field>
				<Field.Label for="mm-message">Message</Field.Label>
				<Textarea
					id="mm-message"
					required
					rows={6}
					bind:value={emailMessage}
					placeholder={'Hi {first_name} — just checking in about…'}
				/>
				<Field.Description>Personalize with {'{name}'} or {'{first_name}'}.</Field.Description>
			</Field.Field>
			<Dialog.Footer><Button type="submit" disabled={pending}>Send</Button></Dialog.Footer>
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

<Dialog.Root bind:open={compOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Grant comp classes</Dialog.Title>
			<Dialog.Description
				>Adds to {m.member.name}'s class-credit cap for the current period (or this pack).</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitComp}>
			<Field.Field>
				<Field.Label for="comp-count">Classes</Field.Label>
				<Input id="comp-count" type="number" min="1" max="50" required bind:value={compCount} />
			</Field.Field>
			<Dialog.Footer><Button type="submit" disabled={!compCount}>Grant</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={cardOpen}>
	<Dialog.Content class="sm:max-w-xs">
		<Dialog.Header>
			<Dialog.Title>Member card</Dialog.Title>
			<Dialog.Description>Print a check-in card for {m.member.name}.</Dialog.Description>
		</Dialog.Header>
		<div class="mx-auto w-64 rounded-xl border p-4 text-center">
			<p class="text-xs font-medium tracking-wide text-muted-foreground uppercase">{m.orgName}</p>
			<p class="mt-1 text-lg font-semibold">{m.member.name}</p>
			{#if cardQr}
				<img src={cardQr} alt="Check-in QR" class="mx-auto mt-3 size-44" />
			{:else}
				<div class="mx-auto mt-3 size-44 animate-pulse rounded bg-muted"></div>
			{/if}
			<p class="mt-2 text-xs text-muted-foreground">Show at the front desk to check in</p>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => window.print()} disabled={!cardQr}
				><Printer class="mr-1 h-3.5 w-3.5" /> Print card</Button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={seriesOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Book into a series</Dialog.Title>
			<Dialog.Description
				>Book {m.member.name} into every upcoming session of a class — full sessions go to the waitlist,
				ones they're already in are skipped.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitSeries}>
			<Field.Field>
				<Field.Label>Class</Field.Label>
				<Select.Root type="single" bind:value={seriesTypeId}>
					<Select.Trigger class="w-full"
						>{classTypes.find((ct) => ct.id === seriesTypeId)?.name ??
							'Pick a class…'}</Select.Trigger
					>
					<Select.Content>
						{#each classTypes as ct (ct.id)}
							<Select.Item value={ct.id}>{ct.name}</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label>For the next</Field.Label>
				<Select.Root
					type="single"
					value={String(seriesWeeks)}
					onValueChange={(v) => (seriesWeeks = Number(v))}
				>
					<Select.Trigger class="w-full">{seriesWeeks} weeks</Select.Trigger>
					<Select.Content>
						{#each [2, 4, 8, 12] as w (w)}
							<Select.Item value={String(w)}>{w} weeks</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={!seriesTypeId || seriesPending}>Book series</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={bookOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Book {m.member.name} into a class</Dialog.Title>
			<Dialog.Description
				>Upcoming sessions in the next two weeks — full sessions go to the waitlist.</Dialog.Description
			>
		</Dialog.Header>
		<div class="max-h-80 space-y-1 overflow-y-auto">
			{#each bookable as s (s.session.id)}
				<button
					type="button"
					class="flex w-full items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent disabled:opacity-50"
					disabled={bookPending !== null || (!hasActiveMembership && !s.dropInPrice)}
					onclick={() => bookInto(s.session.id, s.dropInPrice)}
				>
					<span class="min-w-0">
						<span class="block truncate font-medium">{s.className}</span>
						<span class="text-xs text-muted-foreground"
							>{localDate(s.session.startsAt, tz)}
							{localTime(s.session.startsAt, tz)}{s.locationName
								? ` · ${s.locationName}`
								: ''}</span
						>
					</span>
					<span class="shrink-0 text-right text-xs text-muted-foreground tabular-nums"
						>{s.booked}/{s.session.capacity}{s.waitlisted ? ` (+${s.waitlisted} wl)` : ''}
						{#if !hasActiveMembership}
							<span class="block font-medium text-amber-600 dark:text-amber-400"
								>{s.dropInPrice
									? `drop-in ${formatMoney(s.dropInPrice, currency)}`
									: 'no drop-in price'}</span
							>
						{/if}</span
					>
				</button>
			{:else}
				<p class="py-6 text-center text-sm text-muted-foreground">No upcoming sessions to book.</p>
			{/each}
		</div>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={mergeOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Merge a duplicate into {m.member.name}</Dialog.Title>
			<Dialog.Description>
				Pick the duplicate record — its memberships, bookings, check-ins, charges, payments, tags,
				notes and documents move onto this member, then the duplicate is deleted. This can't be
				undone.
			</Dialog.Description>
		</Dialog.Header>
		<Input placeholder="Search members…" bind:value={mergeQ} oninput={searchMerge} autofocus />
		<div class="max-h-52 overflow-y-auto rounded-md border">
			{#each mergeResults as r (r.id)}
				<button
					type="button"
					class="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-muted {mergePick ===
					r.id
						? 'bg-muted font-medium'
						: ''}"
					onclick={() => (mergePick = r.id)}
				>
					<span class="truncate">{r.name}</span>
					<span class="shrink-0 text-xs text-muted-foreground">{r.email ?? r.phone ?? ''}</span>
				</button>
			{:else}
				<p class="px-3 py-4 text-sm text-muted-foreground">No members match.</p>
			{/each}
		</div>
		<Dialog.Footer>
			<Button variant="destructive" disabled={!mergePick || mergePending} onclick={doMerge}>
				{mergePending ? 'Merging…' : 'Merge and delete duplicate'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<div id="member-card-print" class="hidden print:block">
	<div class="mx-auto w-80 rounded-xl border-2 border-black p-6 text-center">
		<p class="text-sm font-medium tracking-wide uppercase">{m.orgName}</p>
		<p class="mt-1 text-2xl font-bold">{m.member.name}</p>
		{#if cardQr}<img src={cardQr} alt="Check-in QR" class="mx-auto mt-4" />{/if}
		<p class="mt-3 text-sm">Show at the front desk to check in</p>
	</div>
</div>

<svelte:head>
	<style>
		@media print {
			body * {
				visibility: hidden;
			}
			#member-card-print,
			#member-card-print * {
				visibility: visible;
			}
			#member-card-print {
				position: absolute;
				top: 0;
				left: 0;
				width: 100%;
			}
		}
	</style>
</svelte:head>
