<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
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
	import * as DropdownMenu from '#lib/components/ui/dropdown-menu/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { NativeSelect } from '#lib/components/ui/native-select/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { toCsv } from '#lib/csv.ts';
	import { toast } from 'svelte-sonner';
	import {
		getMember,
		extendPack,
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
		mergeMembers,
		logIncident,
		updateIncidentEntry,
		resolveMemberIssue,
		sendSignRequest,
		voidSignRequest,
		getMemberWorkouts,
		getMemberPrograms,
		getPrograms,
		assignProgram,
		setProgramStatus,
		saveProgram,
		removeProgram,
		addMemberWorkout,
		updateMemberWorkout,
		deleteMemberWorkout,
		getPackRemaining,
		transferPackCredits,
		getMemberLocker,
		getLockers,
		getLevels,
		setMemberLevel,
		getMemberLoans,
		getLoanables,
		loanItem,
		returnLoan,
		assignLocker,
		releaseLocker,
		approveTrial,
		declineTrial,
		anonymizeMember,
		getMemberGiftCards
	} from '#lib/remote/members.remote.ts';
	import {
		getPlans,
		createMembership,
		updateMembership,
		recordPayment,
		refundPayment,
		getCurrency,
		grantCredits,
		sellDayPass
	} from '#lib/remote/billing.remote.ts';
	import {
		getClassTypes,
		bookSeries,
		getSessions,
		bookSession
	} from '#lib/remote/schedule.remote.ts';
	import {
		getChallenges,
		joinMemberChallenge,
		removeMemberChallenge
	} from '#lib/remote/challenges.remote.ts';
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
	import Ellipsis from '@lucide/svelte/icons/ellipsis';
	import FilePen from '@lucide/svelte/icons/file-pen';
	import Printer from '@lucide/svelte/icons/printer';
	import { paymentMethods } from '#lib/schemas.ts';

	const id = page.params.id!;
	const m = $derived(await getMember(id));
	const workouts = $derived(await getMemberWorkouts(id));
	const memberPrograms = $derived(await getMemberPrograms(id));
	const programs = $derived(await getPrograms());
	let assignOpen = $state(false);
	let assignProgramId = $state('');
	let assignStart = $state(new Date().toISOString().slice(0, 10));
	let libOpen = $state(false);
	let libEditing = $state<null | {
		id?: string;
		name: string;
		weeks: number;
		note: string;
		days: { dayNo: number; title: string; body: string }[];
	}>(null);
	function openProgram(p?: {
		program: { id: string; name: string; weeks: number; note: string | null };
		days: { dayNo: number; title: string; body: string }[];
	}) {
		libEditing = p
			? {
					id: p.program.id,
					name: p.program.name,
					weeks: p.program.weeks,
					note: p.program.note ?? '',
					days: p.days.map((d) => ({ dayNo: d.dayNo, title: d.title, body: d.body }))
				}
			: {
					name: '',
					weeks: 4,
					note: '',
					days: [{ dayNo: 1, title: '', body: '' }]
				};
	}
	const mSignReqs = $derived(m.signRequests);
	const mIncidents = $derived(m.incidents);
	const memberNotes = $derived(await getMemberNotes(id));
	const challenges = $derived(await getChallenges());
	const memberChallenges = $derived(
		challenges
			.map((c) => ({ ...c, mine: c.entries.find((e) => e.entry.memberId === id) }))
			.filter((c) => c.mine)
	);
	const joinableChallenges = $derived(
		challenges.filter(
			(c) =>
				c.challenge.active && c.state !== 'ended' && !c.entries.some((e) => e.entry.memberId === id)
		)
	);
	let chalPending = $state('');
	async function enrollChallenge(challengeId: string) {
		chalPending = challengeId;
		try {
			await joinMemberChallenge({ challengeId, memberId: id });
			toast.success('Enrolled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not enroll'));
		}
		chalPending = '';
	}
	async function dropChallenge(challengeId: string) {
		chalPending = challengeId;
		try {
			await removeMemberChallenge({ challengeId, memberId: id });
			toast.success('Removed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove'));
		}
		chalPending = '';
	}
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

	// ------- incidents -------
	let incOpen = $state(false);
	let incKind = $state<'injury' | 'incident'>('injury');
	let incDate = $state('');
	let incDesc = $state('');
	let incPending = $state(false);
	async function addIncident(e: SubmitEvent) {
		e.preventDefault();
		if (!incDesc.trim() || !incDate) return;
		incPending = true;
		try {
			await logIncident({
				memberId: id,
				kind: incKind,
				occurredOn: incDate,
				description: incDesc.trim()
			});
			incOpen = false;
			incDesc = incDate = '';
			toast.success('Incident logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log'));
		}
		incPending = false;
	}
	async function resolveIssue(issueId: string) {
		try {
			await resolveMemberIssue({ id: issueId, memberId: id });
			toast.success('Issue resolved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not resolve'));
		}
	}
	async function closeIncident(incidentId: string) {
		const followUp = prompt('Follow-up notes (what was done):') ?? '';
		try {
			await updateIncidentEntry({ id: incidentId, memberId: id, status: 'closed', followUp });
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- signature requests -------
	let srOpen = $state(false);
	let srTitle = $state('');
	let srBody = $state('');
	let srPending = $state(false);
	async function sendRequest(e: SubmitEvent) {
		e.preventDefault();
		if (!srTitle.trim() || !srBody.trim()) return;
		srPending = true;
		try {
			await sendSignRequest({ memberId: id, title: srTitle.trim(), body: srBody.trim() });
			srOpen = false;
			srTitle = srBody = '';
			toast.success('Sent — the member signs in their portal');
		} catch (err) {
			toast.error(errMsg(err, 'Could not send'));
		}
		srPending = false;
	}
	async function voidRequest(reqId: string) {
		try {
			await voidSignRequest({ id: reqId, memberId: id });
		} catch (err) {
			toast.error(errMsg(err, 'Could not void'));
		}
	}

	// ------- tags -------
	const allTags = $derived(await getTags());
	const memberLocker = $derived(await getMemberLocker(id));
	const memberLoans = $derived(await getMemberLoans(id));
	const memberGiftCards = $derived(await getMemberGiftCards(id));
	const loanables = $derived(await getLoanables());
	const freeKit = $derived(loanables.filter((k) => k.out < k.item.quantity));
	let kitPick = $state('');
	$effect(() => {
		if (kitPick) {
			const itemId = kitPick;
			kitPick = '';
			loanItem({ itemId, memberId: id })
				.then(() => toast.success('Checked out'))
				.catch((err) => toast.error(errMsg(err, 'Could not check out')));
		}
	});
	const levels = $derived(await getLevels());
	const levelName = $derived(levels.find((l) => l.id === m.member.skillLevelId)?.name ?? null);
	let levelPick = $state('');
	$effect(() => {
		if (levelPick) {
			const levelId = levelPick;
			levelPick = '';
			setMemberLevel({ memberId: id, levelId })
				.then(() => toast.success('Level updated'))
				.catch((err) => toast.error(errMsg(err, 'Could not set level')));
		}
	});
	const allLockers = $derived(await getLockers());
	const freeLockers = $derived(allLockers.filter((l) => !l.locker.memberId));
	let lockerPick = $state('');
	$effect(() => {
		if (lockerPick) {
			const lockerId = lockerPick;
			lockerPick = '';
			assignLocker({ lockerId, memberId: id })
				.then(() => toast.success('Locker assigned'))
				.catch((err) => toast.error(errMsg(err, 'Could not assign')));
		}
	});
	async function releaseMemberLocker() {
		if (!memberLocker) return;
		try {
			await releaseLocker({ id: memberLocker.id, memberId: id });
			toast.success('Locker released');
		} catch (err) {
			toast.error(errMsg(err, 'Could not release'));
		}
	}
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
	const openChargesCount = $derived(m.charges.filter((c) => c.charge.status === 'open').length);
	const memberMonths = $derived(
		m.member.joinedAt
			? Math.max(
					0,
					Math.floor((Date.now() - new Date(m.member.joinedAt).getTime()) / (30.4 * 86400_000))
				)
			: 0
	);
	const lifetimePaid = $derived(
		m.payments.filter((p) => !p.refundedAt).reduce((sum, p) => sum + p.amount, 0)
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
	let emName = $state(m.member.emergencyName ?? '');
	let emPhone = $state(m.member.emergencyPhone ?? '');
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
				emergencyName: emName || null,
				emergencyPhone: emPhone || null,
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

	// ------- assigned workouts -------
	let woOpen = $state(false);
	let woId = $state<string | null>(null);
	let woTitle = $state('');
	let woBody = $state('');
	function openWorkout(w?: { id: string; title: string; body: string }) {
		woId = w?.id ?? null;
		woTitle = w?.title ?? '';
		woBody = w?.body ?? '';
		woOpen = true;
	}
	async function saveWorkout(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			if (woId) await updateMemberWorkout({ id: woId, title: woTitle.trim(), body: woBody.trim() });
			else await addMemberWorkout({ memberId: id, title: woTitle.trim(), body: woBody.trim() });
			toast.success(woId ? 'Workout updated' : 'Workout assigned');
			woOpen = false;
			await getMemberWorkouts(id).refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not save workout'));
		}
		pending = false;
	}
	async function removeWorkout(wid: string) {
		try {
			await deleteMemberWorkout(wid);
			toast.success('Workout removed');
			await getMemberWorkouts(id).refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove'));
		}
	}

	// ------- pack credit transfer -------
	let trOpen = $state(false);
	let trMsId = $state('');
	let trTo = $state('');
	let trCredits = $state('1');
	let trRemaining = $state(0);
	async function openTransfer(membershipId: string) {
		trMsId = membershipId;
		trTo = '';
		trCredits = '1';
		trOpen = true;
		const r = await getPackRemaining(membershipId);
		trRemaining = r?.remaining ?? 0;
	}
	async function sendTransfer(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const r = await transferPackCredits({
				membershipId: trMsId,
				toMemberId: trTo,
				credits: parseInt(trCredits) || 0
			});
			const n = parseInt(trCredits) || 0;
			toast.success(`${r.toName} got ${n} class${n === 1 ? '' : 'es'}`);
			trOpen = false;
			await getMember(id).refresh();
		} catch (err) {
			toast.error(errMsg(err, 'Could not transfer'));
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
	let planChangeProrate = $state(false);
	async function submitPlanChange(e: SubmitEvent) {
		e.preventDefault();
		const price = planChangePrice != null ? planChangePrice : planChangeHadPrice ? null : undefined;
		if (!planChangePlanId && price === undefined) return;
		pending = true;
		try {
			await updateMembership({
				id: planChangeId,
				planId: planChangePlanId || undefined,
				prorate: planChangePlanId ? planChangeProrate : undefined,
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
	async function sellPass() {
		try {
			const r = await sellDayPass(id);
			toast.success(`Day pass posted — ${formatMoney(r.charge.amount, currency)} on their balance`);
		} catch (e) {
			toast.error(errMsg(e, 'Could not sell the pass'));
		}
	}
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
	let bookGuests = $state(0);
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
	/** No active membership → the dialog sells paid drop-ins instead of booking.
	 * Dependents may draw from a guardian's pack, so a no-membership member tries
	 * a normal booking first and only falls back to drop-in on the 402. */
	const hasActiveMembership = m.memberships.some((mm) => mm.membership.status === 'active');
	async function bookInto(sessionId: string, dropInPrice?: number | null) {
		bookPending = sessionId;
		try {
			let b: Awaited<ReturnType<typeof bookSession>>;
			let dropIn = false;
			if (hasActiveMembership) {
				b = await bookSession({ sessionId, memberId: id, guests: bookGuests });
			} else {
				try {
					b = await bookSession({ sessionId, memberId: id, guests: bookGuests });
				} catch {
					dropIn = true;
					b = await bookSession({ sessionId, memberId: id, dropIn: true, guests: bookGuests });
				}
			}
			toast.success(
				dropIn
					? `Drop-in booked — ${formatMoney(dropInPrice ?? 0, currency)} charge posted`
					: b.status === 'waitlisted'
						? 'Class full — waitlisted'
						: 'Booked'
			);
			bookOpen = false;
			bookGuests = 0;
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

	let trialBusy = $state('');
	async function trialDecision(requestId: string, approve: boolean) {
		trialBusy = requestId;
		try {
			if (approve) {
				await approveTrial({ requestId, memberId: id });
				toast.success('Trial confirmed — seat booked, member emailed');
			} else {
				await declineTrial({ requestId, memberId: id });
				toast.success('Trial declined — member emailed');
			}
		} catch (err) {
			toast.error(errMsg(err, 'Could not update the request'));
		}
		trialBusy = '';
	}

	async function doAnonymize() {
		if (
			!confirm(
				'Anonymize this member? Name, email, phone, birthday, notes, photo and measurements are permanently scrubbed. Booking and payment history is kept for accounting. This cannot be undone.'
			)
		)
			return;
		try {
			await anonymizeMember(id);
			toast.success('Personal data anonymized');
		} catch (err) {
			toast.error(errMsg(err, 'Could not anonymize'));
		}
	}
</script>

<PageHeader title={m.member.name} crumbs={[{ label: 'Members', href: '/members' }]}>
	{#snippet actions()}
		<Button variant="outline" size="sm" onclick={manualCheckIn}><ScanLine /> Check in</Button>
		{#if m.member.email}
			<Button variant="outline" size="sm" onclick={() => (emailOpen = true)}><Mail /> Email</Button>
		{/if}
		<Button size="sm" variant="outline" onclick={() => (editOpen = true)}>Edit</Button>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button variant="outline" size="sm" {...props} aria-label="More actions">
						<Ellipsis class="h-4 w-4" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end" class="min-w-48">
				<DropdownMenu.Item onclick={() => (guestOpen = true)}
					><UserPlus /> Book a guest</DropdownMenu.Item
				>
				<DropdownMenu.Item onclick={openCard}><Printer /> Print member card</DropdownMenu.Item>
				<DropdownMenu.Item onclick={() => goto(`/members/${m.member.id}/statement`)}
					><FileText /> Statement</DropdownMenu.Item
				>
				<DropdownMenu.Item onclick={copyPortalLink}><Link /> Copy portal link</DropdownMenu.Item>
				<DropdownMenu.Separator />
				<DropdownMenu.Item onclick={openMerge}>Merge into another member…</DropdownMenu.Item>
				<DropdownMenu.Item onclick={doAnonymize} class="text-destructive"
					>Anonymize personal data…</DropdownMenu.Item
				>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
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
				{#if m.member.deletionRequestedAt}
					<div
						class="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-destructive"
					>
						Requested deletion of their personal data {formatDate(m.member.deletionRequestedAt)} — use
						"Anonymize personal data" in the menu.
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Status</span><StatusBadge status={m.member.status} />
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Email</span>
					<span class="flex items-center gap-1 truncate">
						<span class="truncate">{m.member.email ?? '—'}</span>
						{#if m.member.email}
							<Button
								variant="ghost"
								class="h-6 px-1.5"
								onclick={() =>
									navigator.clipboard
										.writeText(m.member.email!)
										.then(() => toast.success('Email copied'))
										.catch(() => toast.error('Could not copy'))}>Copy</Button
							>
						{/if}
					</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Phone</span><span>{m.member.phone ?? '—'}</span>
				</div>
				{#if m.member.emergencyName || m.member.emergencyPhone}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Emergency</span><span class="truncate"
							>{m.member.emergencyName ?? ''}{m.member.emergencyName && m.member.emergencyPhone
								? ' · '
								: ''}{m.member.emergencyPhone ?? ''}</span
						>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">Location</span><span>{m.locationName ?? '—'}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Joined</span><span
						>{formatDate(m.member.joinedAt)}{memberMonths > 0 ? ` · ${memberMonths} mo` : ''}</span
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
				<div class="flex items-center justify-between">
					<span class="text-muted-foreground">Referral link</span>
					<Button
						variant="ghost"
						size="sm"
						onclick={() =>
							navigator.clipboard
								.writeText(`${location.origin}/j/${m.orgSlug}?ref=${m.member.id}`)
								.then(() => toast.success('Referral link copied'))
								.catch(() => toast.error('Could not copy'))}>Copy</Button
					>
				</div>
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
					<span class="text-muted-foreground">Classes booked</span>
					<span class="tabular-nums">{m.attendance.bookedMonth} this month</span>
				</div>
				{#if m.attendance.waitlisted > 0}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Waitlisted</span>
						<span class="tabular-nums">{m.attendance.waitlisted} upcoming</span>
					</div>
				{/if}
				{#if m.attendance.firstVisit}
					<div class="flex justify-between">
						<span class="text-muted-foreground">First visit</span>
						<span class="tabular-nums">{formatDate(m.attendance.firstVisit)}</span>
					</div>
				{/if}
				{#if m.attendance.lastVisit}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Last visit</span>
						<span class="tabular-nums">{formatDate(m.attendance.lastVisit)}</span>
					</div>
				{/if}
				{@const nextMile = [10, 25, 50, 100, 250, 500, 1000].find((n) => n > m.attendance.visits)}
				{#if nextMile}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Next milestone</span>
						<span class="text-muted-foreground tabular-nums"
							>{nextMile} ({nextMile - m.attendance.visits} to go)</span
						>
					</div>
				{/if}
				{#if m.loyalty}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Loyalty</span>
						<Badge variant="secondary" class={m.loyalty.className}>{m.loyalty.name}</Badge>
					</div>
				{/if}
				{#if m.attendance.topClass}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Go-to class</span>
						<span class="truncate">{m.attendance.topClass}</span>
					</div>
				{/if}
				{#if m.weekStreak > 0}
					<div class="flex justify-between">
						<span class="text-muted-foreground">Streak</span>
						<span class="tabular-nums"
							>{m.weekStreak} week{m.weekStreak === 1 ? '' : 's'} in a row</span
						>
					</div>
				{/if}
				<div class="flex justify-between">
					<span class="text-muted-foreground">No-shows</span>
					<span class="tabular-nums"
						>{m.attendance.noShows}{m.attendance.showRate != null
							? ` · ${m.attendance.showRate}% show rate`
							: ''}{#if m.bookings.some((b) => b.booking.status === 'no_show')}
							{@const lastNs = m.bookings
								.filter((b) => b.booking.status === 'no_show')
								.map((b) => new Date(b.startsAt).getTime())
								.reduce((a, t) => Math.max(a, t), 0)}
							<span class="text-xs text-muted-foreground"
								>· last {formatDate(new Date(lastNs))}</span
							>
						{/if}</span
					>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Open balance</span>
					<span class="font-medium tabular-nums">{formatMoney(balance, currency)}</span>
				</div>
				<div class="flex justify-between">
					<span class="text-muted-foreground">Lifetime paid</span>
					<span class="text-muted-foreground tabular-nums"
						>{formatMoney(lifetimePaid, currency)}</span
					>
				</div>
				<div class="flex items-center justify-between gap-2">
					<span class="text-muted-foreground">Level</span>
					<span class="flex items-center gap-1.5">
						{#if levels.length}
							<NativeSelect size="sm" class="w-auto" bind:value={levelPick}>
								<option value="">{levelName ?? 'set…'}</option>
								{#each levels as l (l.id)}
									<option value={l.id}>{l.name}</option>
								{/each}
							</NativeSelect>
						{:else}
							<span class="text-muted-foreground">{levelName ?? '—'}</span>
						{/if}
					</span>
				</div>
				<div class="flex items-center justify-between gap-2">
					<span class="text-muted-foreground">Locker</span>
					<span class="flex items-center gap-1.5">
						{#if memberLocker}
							<span class="font-medium">{memberLocker.label}</span>
							<button
								class="text-xs text-muted-foreground underline-offset-2 hover:underline"
								onclick={releaseMemberLocker}>release</button
							>
						{:else if freeLockers.length}
							<NativeSelect size="sm" class="w-auto" bind:value={lockerPick}>
								<option value="">assign…</option>
								{#each freeLockers as l (l.locker.id)}
									<option value={l.locker.id}>{l.locker.label}</option>
								{/each}
							</NativeSelect>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/if}
					</span>
				</div>
				<div class="flex items-start justify-between gap-2">
					<span class="pt-0.5 text-muted-foreground">Kit out</span>
					<span class="flex max-w-56 flex-wrap justify-end gap-1">
						{#each memberLoans.filter((l) => !l.loan.returnedAt) as l (l.loan.id)}
							<Badge variant="secondary" class="gap-1">
								{l.itemName}
								<button
									class="text-muted-foreground hover:text-foreground"
									aria-label="Return {l.itemName}"
									onclick={async () => {
										try {
											await returnLoan({ loanId: l.loan.id, memberId: id });
											toast.success('Returned');
										} catch (err) {
											toast.error(errMsg(err, 'Could not return'));
										}
									}}>×</button
								>
							</Badge>
						{:else}
							<span class="text-muted-foreground">—</span>
						{/each}
						{#if freeKit.length}
							<NativeSelect size="sm" class="w-auto" bind:value={kitPick}>
								<option value="">lend…</option>
								{#each freeKit as k (k.item.id)}
									<option value={k.item.id}>{k.item.name}</option>
								{/each}
							</NativeSelect>
						{/if}
					</span>
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
			<Card.Footer>
				<Button variant="outline" size="sm" class="w-full" onclick={() => void sellPass()}
					>Sell day pass</Button
				>
			</Card.Footer>
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

		{#if m.trialRequests.length}
			<Card.Root class="border-amber-500/50">
				<Card.Header>
					<Card.Title class="text-base">Trial requests</Card.Title>
					<Card.Description>Free-trial classes this member asked for</Card.Description>
				</Card.Header>
				<Card.Content class="px-4">
					{#each m.trialRequests as t (t.request.id)}
						<div class="flex items-center justify-between gap-2 py-1.5 text-sm">
							<span class="min-w-0 truncate font-medium">{t.className}</span>
							<span class="flex shrink-0 items-center gap-1.5">
								<span class="text-xs text-muted-foreground"
									>{formatDate(t.startsAt)} · {localTime(t.startsAt, tz)}</span
								>
								<Button
									size="sm"
									variant="outline"
									class="h-7 px-2"
									disabled={trialBusy === t.request.id}
									onclick={() => trialDecision(t.request.id, true)}>Confirm</Button
								>
								<Button
									size="sm"
									variant="ghost"
									class="h-7 px-2 text-destructive"
									disabled={trialBusy === t.request.id}
									onclick={() => trialDecision(t.request.id, false)}>Decline</Button
								>
							</span>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}
		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<Card.Title class="text-base">Memberships</Card.Title>
				<Button size="sm" variant="outline" onclick={() => (memOpen = true)}><Plus /> New</Button>
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				{#each m.memberships as mm (mm.membership.id)}
					<div class="flex items-center justify-between gap-2 text-sm">
						<div class="min-w-0">
							<p class="truncate font-medium" title={mm.planName}>{mm.planName}</p>
							<p class="text-xs text-muted-foreground">
								{formatMoney(mm.membership.price ?? mm.amount, currency)}{mm.isPack
									? ' pack'
									: `/${mm.interval}`}{mm.membership.price != null ? ' (custom)' : ''} · from {formatDate(
									mm.membership.startsAt
								)}{mm.membership.endsAt ? ` · expires ${formatDate(mm.membership.endsAt)}` : ''}{mm
									.membership.frozenUntil
									? ` · paused until ${formatDate(mm.membership.frozenUntil)}`
									: ''}{mm.membership.status === 'active' &&
								!mm.membership.noBill &&
								mm.membership.nextChargeAt
									? ` · next bill ${formatDate(mm.membership.nextChargeAt)}`
									: ''}
							</p>
							{#if mm.membership.noBill}
								<p class="text-xs text-emerald-600 dark:text-emerald-400">Comp'd — never bills</p>
							{/if}
							{#if mm.membership.bonusCredits}
								<p class="text-xs text-emerald-600 dark:text-emerald-400">
									{mm.membership.bonusCredits} comp class{mm.membership.bonusCredits === 1
										? ''
										: 'es'} banked
								</p>
							{/if}
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
						<div class="flex flex-wrap items-center justify-end gap-2">
							<StatusBadge status={mm.membership.status} />
							{#if mm.membership.status === 'active'}
								{#if mm.isPack}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										title="Buy the same pack again when it runs out or expires"
										onclick={() =>
											updateMembership({
												id: mm.membership.id,
												autoRenew: !mm.membership.autoRenew
											})
												.then(() =>
													toast.success(
														mm.membership.autoRenew ? 'Auto-renew off' : 'Pack will auto-renew'
													)
												)
												.catch((e) => toast.error(errMsg(e, 'Could not update')))}
										>{mm.membership.autoRenew ? 'Auto-renew ✓' : 'Auto-renew'}</Button
									>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										title="Move pack classes to another member"
										onclick={() => void openTransfer(mm.membership.id)}>Gift</Button
									>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										title="Push this pack's expiry out — 'paid before it lapsed' fixes"
										onclick={async () => {
											const days = Number(
												window.prompt(
													`Extend the pack by how many days? (currently ${
														mm.membership.endsAt ? formatDate(mm.membership.endsAt) : 'no expiry'
													})`,
													'30'
												)
											);
											if (!days || days <= 0) return;
											try {
												const r = await extendPack({ membershipId: mm.membership.id, days });
												toast.success(`Pack extended to ${formatDate(r.endsAt)}`);
											} catch (err) {
												toast.error(errMsg(err, 'Could not extend'));
											}
										}}>Extend</Button
									>
								{:else}
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs"
										title="Comp'd membership — the billing job never charges it"
										onclick={() =>
											updateMembership({
												id: mm.membership.id,
												noBill: !mm.membership.noBill
											})
												.then(() =>
													toast.success(
														mm.membership.noBill ? 'Will bill again' : "Comp'd — never bills"
													)
												)
												.catch((e) => toast.error(errMsg(e, 'Could not update')))}
										>{mm.membership.noBill ? 'Comp’d ✓' : 'Comp'}</Button
									>
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
											(planChangeProrate = false),
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
							{m.credits.used} of {m.credits.limit}{m.credits.className
								? ` ${m.credits.className}`
								: ''} classes used this period{m.credits.bonus ? ` (+${m.credits.bonus} comp)` : ''}
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
			<Card.Header class="flex-row items-center justify-between">
				<div>
					<Card.Title class="text-base">Signature requests</Card.Title>
					<Card.Description>Documents the member signs in their portal</Card.Description>
				</div>
				<Button size="sm" variant="outline" onclick={() => (srOpen = true)}>
					<FilePen /> Request signature
				</Button>
			</Card.Header>
			<Card.Content class="px-4">
				{#each mSignReqs as r (r.id)}
					<div class="flex items-center justify-between gap-2 py-1.5 text-sm">
						<div class="min-w-0">
							<span class="truncate font-medium">{r.title}</span>
							{#if r.status === 'signed'}
								<span class="block text-xs text-muted-foreground"
									>Signed by {r.signedName} · {formatRelative(r.signedAt!)}</span
								>
							{/if}
						</div>
						<div class="flex shrink-0 items-center gap-2">
							<Badge
								variant={r.status === 'signed'
									? 'secondary'
									: r.status === 'pending'
										? 'outline'
										: 'destructive'}>{r.status}</Badge
							>
							{#if r.status === 'pending'}
								<Button
									size="sm"
									variant="ghost"
									class="h-7 px-1.5 text-destructive"
									onclick={() => voidRequest(r.id)}>Void</Button
								>
							{/if}
						</div>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">
						No requests yet — send a release form or agreement for the member to sign online.
					</p>
				{/each}
			</Card.Content>
		</Card.Root>

		{#if m.issues.length}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Member issues</Card.Title>
					<Card.Description>Problems the member reported in the portal</Card.Description>
				</Card.Header>
				<Card.Content class="px-4">
					{#each m.issues as i (i.id)}
						<div class="flex items-center justify-between gap-2 py-1.5 text-sm">
							<span class="min-w-0 break-words">{i.text}</span>
							<span class="flex shrink-0 items-center gap-2">
								<span class="text-xs text-muted-foreground">
									{formatRelative(i.createdAt)}
								</span>
								{#if i.status === 'open'}
									<Button
										size="sm"
										variant="ghost"
										class="h-7 px-1.5"
										onclick={() => resolveIssue(i.id)}>Resolve</Button
									>
								{:else}
									<Badge variant="secondary">resolved</Badge>
								{/if}
							</span>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<div>
					<Card.Title class="text-base">Incident reports</Card.Title>
					<Card.Description>Injuries and incidents involving this member</Card.Description>
				</div>
				<Button size="sm" variant="outline" onclick={() => (incOpen = true)}>
					<Plus /> Log incident
				</Button>
			</Card.Header>
			<Card.Content class="px-4">
				{#each mIncidents as i (i.id)}
					<div class="py-1.5 text-sm">
						<div class="flex items-center justify-between gap-2">
							<span class="min-w-0 truncate">
								<Badge variant={i.kind === 'injury' ? 'destructive' : 'outline'} class="mr-1.5"
									>{i.kind}</Badge
								>
								{i.description}
							</span>
							<span class="flex shrink-0 items-center gap-2">
								<span class="text-xs text-muted-foreground">{i.occurredOn}</span>
								{#if i.status === 'open'}
									<Button
										size="sm"
										variant="ghost"
										class="h-7 px-1.5"
										onclick={() => closeIncident(i.id)}>Close</Button
									>
								{:else}
									<Badge variant="secondary">closed</Badge>
								{/if}
							</span>
						</div>
						{#if i.followUp}<p class="mt-0.5 text-xs text-muted-foreground">{i.followUp}</p>{/if}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No incident reports.</p>
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

		{#if m.scores.length}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Workout scores</Card.Title>
					<Card.Description>Scores the member logged on workouts of the day</Card.Description>
				</Card.Header>
				<Card.Content class="px-4">
					{#each m.scores as s (s.result.id)}
						<div class="flex items-baseline gap-2 py-1 text-sm">
							<span class="w-28 shrink-0 text-xs text-muted-foreground"
								>{localDate(s.startsAt, tz)}</span
							>
							<span class="min-w-0 truncate">{s.className}</span>
							<span class="ml-auto shrink-0 font-medium"
								>{s.result.score}{s.result.asRx ? ' Rx' : ''}</span
							>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if m.prs.length}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Personal records</Card.Title>
					<Card.Description>PRs the member logged in the portal</Card.Description>
				</Card.Header>
				<Card.Content class="px-4">
					{#each m.prs as pr (pr.id)}
						<div class="flex items-baseline gap-2 py-1 text-sm">
							<span class="w-28 shrink-0 text-xs text-muted-foreground">{pr.recordedOn}</span>
							<span class="min-w-0 truncate">{pr.label}</span>
							<span class="ml-auto shrink-0 font-medium">{pr.value}</span>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		{#if m.workoutLogs.length}
			<Card.Root>
				<Card.Header>
					<Card.Title class="text-base">Workout log</Card.Title>
					<Card.Description>Free-form entries the member logged in the portal</Card.Description>
				</Card.Header>
				<Card.Content class="px-4">
					{#each m.workoutLogs as w (w.id)}
						<div class="flex items-baseline gap-2 py-1 text-sm">
							<span class="w-28 shrink-0 text-xs text-muted-foreground">{w.day}</span>
							<span class="min-w-0 break-words">{w.text}</span>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>
		{/if}

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<div>
					<Card.Title class="text-base">Assigned workouts</Card.Title>
					<Card.Description>Routines the member sees in their portal</Card.Description>
				</div>
				<Button size="sm" variant="outline" onclick={() => openWorkout()}><Plus /> Assign</Button>
			</Card.Header>
			<Card.Content class="space-y-3 px-4">
				{#each workouts as w (w.id)}
					<div class="rounded-md border p-3 text-sm">
						<div class="flex items-center justify-between gap-2">
							<span class="font-medium">{w.title}</span>
							<span class="flex shrink-0 gap-1">
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => openWorkout(w)}>Edit</Button
								>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-destructive"
									onclick={() => void removeWorkout(w.id)}>Remove</Button
								>
							</span>
						</div>
						<p class="mt-1 whitespace-pre-wrap text-muted-foreground">{w.body}</p>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No workouts assigned yet.</p>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header class="flex-row items-center justify-between">
				<div>
					<Card.Title class="text-base">Workout program</Card.Title>
					<Card.Description
						>Reusable multi-week plans — the member's portal shows today's day</Card.Description
					>
				</div>
				<span class="flex gap-1">
					<Button size="sm" variant="ghost" onclick={() => (libOpen = true)}>Library</Button>
					<Button size="sm" variant="outline" onclick={() => (assignOpen = true)}
						><Plus /> Assign</Button
					>
				</span>
			</Card.Header>
			<Card.Content class="space-y-2 px-4">
				{#each memberPrograms as mp (mp.assignment.id)}
					<div class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
						<div class="min-w-0">
							<p class="truncate font-medium">
								{mp.program.name}
								<span class="font-normal text-muted-foreground">
									· {mp.program.weeks}w · starts {mp.assignment.startDate}</span
								>
							</p>
						</div>
						<span class="flex shrink-0 items-center gap-1">
							<Badge variant={mp.assignment.status === 'active' ? 'default' : 'secondary'}
								>{mp.assignment.status}</Badge
							>
							{#if mp.assignment.status === 'active'}
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={async () => {
										await setProgramStatus({
											assignmentId: mp.assignment.id,
											memberId: id,
											status: 'done'
										});
										toast.success('Marked done');
									}}>Done</Button
								>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-destructive"
									onclick={async () => {
										await setProgramStatus({
											assignmentId: mp.assignment.id,
											memberId: id,
											status: 'stopped'
										});
									}}>Stop</Button
								>
							{/if}
						</span>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No program assigned.</p>
				{/each}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Challenges</Card.Title>
				<Card.Description>Check-in challenges this member is in</Card.Description>
			</Card.Header>
			<Card.Content class="px-4">
				{#each memberChallenges as c (c.challenge.id)}
					<div class="flex items-center justify-between gap-2 py-1 text-sm">
						<span class="min-w-0 truncate font-medium">{c.challenge.name}</span>
						<span class="shrink-0 text-xs text-muted-foreground"
							>{c.mine!.count}/{c.challenge.goal} check-ins</span
						>
						<Badge variant={c.state === 'live' ? 'default' : 'outline'} class="shrink-0"
							>{c.state}</Badge
						>
						<Button
							size="sm"
							variant="ghost"
							class="h-6 px-2 text-xs text-muted-foreground"
							disabled={chalPending === c.challenge.id}
							onclick={() => dropChallenge(c.challenge.id)}>Remove</Button
						>
					</div>
				{/each}
				{#each joinableChallenges as c (c.challenge.id)}
					<div class="flex items-center justify-between gap-2 py-1 text-sm text-muted-foreground">
						<span class="min-w-0 truncate">
							{c.challenge.name}
							<span class="text-xs">
								· {c.challenge.goal} check-ins · {formatDate(c.challenge.startDate)} – {formatDate(
									c.challenge.endDate
								)}</span
							>
						</span>
						<Button
							size="sm"
							variant="outline"
							class="h-6 shrink-0 px-2 text-xs"
							disabled={chalPending === c.challenge.id}
							onclick={() => enrollChallenge(c.challenge.id)}>Enroll</Button
						>
					</div>
				{/each}
				{#if !memberChallenges.length && !joinableChallenges.length}
					<p class="text-sm text-muted-foreground">No open challenges.</p>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root>
			<Card.Header>
				<Card.Title class="text-base">Emails sent</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#each m.emails as e (e.id)}
					<div class="flex items-center justify-between gap-2 py-1 text-sm">
						<span class="capitalize">{e.kind.replaceAll('_', ' ')}</span>
						<span class="shrink-0 text-xs text-muted-foreground"
							>{#if e.openedAt}
								<Badge variant="secondary" class="mr-1">opened</Badge>
							{/if}{formatRelative(e.createdAt)}</span
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
					<Tabs.Trigger value="charges"
						>Charges{#if openChargesCount}
							<Badge variant="destructive" class="ml-1">{openChargesCount} open</Badge
							>{/if}</Tabs.Trigger
					>
					<Tabs.Trigger value="payments">Payments</Tabs.Trigger>
					<Tabs.Trigger value="bookings">Bookings</Tabs.Trigger>
					<Tabs.Trigger value="checkins">Check-ins</Tabs.Trigger>
					<Tabs.Trigger value="giftcards">Gift cards</Tabs.Trigger>
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
					<div class="mb-2 flex justify-end">
						<Button
							size="sm"
							variant="ghost"
							disabled={!m.bookings.length}
							onclick={() => {
								const csv = toCsv([
									['Class', 'When', 'Status', 'Member note', 'Coach note'],
									...m.bookings.map((b) => [
										b.className,
										new Date(b.startsAt).toISOString(),
										b.booking.status,
										b.booking.memberNote ?? '',
										b.booking.coachNote ?? ''
									])
								]);
								const a = document.createElement('a');
								a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
								a.download = `bookings-${m.member.name.replaceAll(' ', '-')}.csv`;
								a.click();
								URL.revokeObjectURL(a.href);
							}}>Export CSV</Button
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
				<Tabs.Content value="giftcards">
					<Table.Root>
						<Table.Header>
							<Table.Row>
								<Table.Head>Code</Table.Head>
								<Table.Head>Amount</Table.Head>
								<Table.Head>Balance</Table.Head>
								<Table.Head>Status</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each memberGiftCards as g (g.card.id)}
								<Table.Row>
									<Table.Cell class="font-mono text-xs">{g.card.code}</Table.Cell>
									<Table.Cell class="tabular-nums"
										>{formatMoney(g.card.amount, currency)}</Table.Cell
									>
									<Table.Cell class="tabular-nums"
										>{formatMoney(g.card.balance, currency)}</Table.Cell
									>
									<Table.Cell class="text-muted-foreground"
										>{g.card.redeemedAt
											? `redeemed ${formatDate(g.card.redeemedAt)}`
											: g.card.purchaserMemberId === id
												? 'purchased — unused'
												: 'unused'}</Table.Cell
									>
								</Table.Row>
							{:else}
								<Table.Row
									><Table.Cell colspan={4} class="text-muted-foreground">No gift cards.</Table.Cell
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
				Changes apply from the next charge — turn on proration to also settle the price difference
				for the rest of this period now. Set a custom price to bill this member something other than
				the plan's list price.
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
			{#if planChangePlanId}
				<label class="flex items-center gap-3 text-sm">
					<Switch bind:checked={planChangeProrate} />
					<span>
						Prorate this change — posts the price difference for the rest of the period as a charge
						(upgrade) or account credit (downgrade).
					</span>
				</label>
			{/if}
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
			<div class="grid grid-cols-2 gap-2">
				<Field.Field
					><Field.Label for="e-emname">Emergency contact</Field.Label><Input
						id="e-emname"
						placeholder="Name"
						bind:value={emName}
					/></Field.Field
				>
				<Field.Field
					><Field.Label for="e-emphone">&nbsp;</Field.Label><Input
						id="e-emphone"
						placeholder="Phone"
						bind:value={emPhone}
					/></Field.Field
				>
			</div>
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
		<label class="flex items-center gap-2 pb-2 text-sm">
			<span class="text-muted-foreground">Bringing guests</span>
			<NativeSelect bind:value={bookGuests}>
				{#each [0, 1, 2, 3] as n (n)}
					<option value={n}>{n === 0 ? 'None' : `+${n} guest${n > 1 ? 's' : ''}`}</option>
				{/each}
			</NativeSelect>
			{#if bookGuests > 0}
				<span class="text-xs text-muted-foreground">guest passes first, then drop-in price</span>
			{/if}
		</label>
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

<Dialog.Root bind:open={incOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Log incident</Dialog.Title>
			<Dialog.Description>
				Record an injury or incident involving {m.member.name} — kept on their record for follow-up.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={addIncident}>
			<Field.Field>
				<Field.Label>Type</Field.Label>
				<Select.Root
					type="single"
					value={incKind}
					onValueChange={(v) => (incKind = v as 'injury' | 'incident')}
				>
					<Select.Trigger class="w-full"
						>{incKind === 'injury' ? 'Injury' : 'Incident'}</Select.Trigger
					>
					<Select.Content>
						<Select.Item value="injury">Injury</Select.Item>
						<Select.Item value="incident">Incident</Select.Item>
					</Select.Content>
				</Select.Root>
			</Field.Field>
			<Field.Field>
				<Field.Label for="inc-date">Date</Field.Label>
				<Input id="inc-date" type="date" bind:value={incDate} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="inc-desc">What happened</Field.Label>
				<Textarea
					id="inc-desc"
					rows={4}
					placeholder="Rolled ankle during box jumps; ice applied, sat out remainder…"
					bind:value={incDesc}
				/>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={incPending || !incDesc.trim() || !incDate}>
					{incPending ? 'Saving…' : 'Log incident'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={srOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Request signature</Dialog.Title>
			<Dialog.Description>
				The member gets an email and signs this in their portal — release forms, consents,
				agreements.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={sendRequest}>
			<Field.Field>
				<Field.Label for="sr-title">Title</Field.Label>
				<Input id="sr-title" placeholder="Competition release" bind:value={srTitle} />
			</Field.Field>
			<Field.Field>
				<Field.Label for="sr-body">Document text</Field.Label>
				<Textarea id="sr-body" rows={8} placeholder="I agree to…" bind:value={srBody} />
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={srPending || !srTitle.trim() || !srBody.trim()}>
					{srPending ? 'Sending…' : 'Send for signature'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
<Dialog.Root bind:open={woOpen}>
	<Dialog.Content>
		<Dialog.Header
			><Dialog.Title>{woId ? 'Edit workout' : 'Assign a workout'}</Dialog.Title></Dialog.Header
		>
		<form class="space-y-4" onsubmit={saveWorkout}>
			<Field.Field>
				<Field.Label for="wo-title">Title</Field.Label>
				<Input id="wo-title" bind:value={woTitle} placeholder="Leg day" required />
			</Field.Field>
			<Field.Field>
				<Field.Label for="wo-body">Workout</Field.Label>
				<Textarea
					id="wo-body"
					bind:value={woBody}
					rows={8}
					placeholder="3×10 back squats&#10;3×12 lunges&#10;10-min bike cooldown"
					required
				/>
			</Field.Field>
			<Button type="submit" class="w-full" disabled={pending}
				>{pending ? 'Saving…' : woId ? 'Save' : 'Assign'}</Button
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={trOpen}>
	<Dialog.Content>
		<Dialog.Header
			><Dialog.Title>Gift pack classes</Dialog.Title>
			<Dialog.Description
				>Move classes off this pack to another member. {trRemaining} left to give.</Dialog.Description
			>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={sendTransfer}>
			<Field.Field>
				<Field.Label>To member</Field.Label>
				<NativeSelect bind:value={trTo} required>
					<option value="" disabled>Pick a member…</option>
					{#each m.memberOptions as o (o.id)}<option value={o.id}>{o.name}</option>{/each}
				</NativeSelect>
			</Field.Field>
			<Field.Field>
				<Field.Label for="tr-n">Classes</Field.Label>
				<Input id="tr-n" type="number" min="1" max={trRemaining} bind:value={trCredits} required />
			</Field.Field>
			<Button type="submit" class="w-full" disabled={pending || !trTo}
				>{pending ? 'Moving…' : 'Gift classes'}</Button
			>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={assignOpen}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header><Dialog.Title>Assign a program</Dialog.Title></Dialog.Header>
		<form
			class="space-y-4"
			onsubmit={async (e) => {
				e.preventDefault();
				try {
					await assignProgram({ memberId: id, programId: assignProgramId, startDate: assignStart });
					assignOpen = false;
					toast.success('Program assigned');
				} catch (err) {
					toast.error(errMsg(err, 'Could not assign'));
				}
			}}
		>
			<Field.Field>
				<Field.Label>Program</Field.Label>
				<NativeSelect bind:value={assignProgramId} required>
					<option value="" disabled>Pick a program…</option>
					{#each programs as p (p.program.id)}
						<option value={p.program.id}
							>{p.program.name} — {p.program.weeks}w, {p.days.length} days</option
						>
					{/each}
				</NativeSelect>
			</Field.Field>
			<Field.Field>
				<Field.Label>Starts</Field.Label>
				<Input type="date" bind:value={assignStart} required />
			</Field.Field>
			<Button type="submit" class="w-full" disabled={!assignProgramId}>Assign</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={libOpen}>
	<Dialog.Content class="max-w-2xl">
		<Dialog.Header><Dialog.Title>Program library</Dialog.Title></Dialog.Header>
		{#if libEditing}
			<form
				class="space-y-3"
				onsubmit={async (e) => {
					e.preventDefault();
					try {
						await saveProgram({
							id: libEditing!.id,
							name: libEditing!.name,
							weeks: libEditing!.weeks,
							note: libEditing!.note || undefined,
							days: libEditing!.days
						});
						libEditing = null;
						toast.success('Program saved');
					} catch (err) {
						toast.error(errMsg(err, 'Could not save'));
					}
				}}
			>
				<div class="grid grid-cols-[1fr_5rem] gap-2">
					<Field.Field>
						<Field.Label>Name</Field.Label>
						<Input bind:value={libEditing.name} required placeholder="Base strength" />
					</Field.Field>
					<Field.Field>
						<Field.Label>Weeks</Field.Label>
						<Input type="number" min={1} max={52} bind:value={libEditing.weeks} required />
					</Field.Field>
				</div>
				<Input bind:value={libEditing.note} placeholder="Note (optional)" />
				<div class="max-h-64 space-y-2 overflow-y-auto rounded-md border p-2">
					{#each libEditing.days as day, i (day.dayNo)}
						<div class="space-y-1 rounded border p-2">
							<div class="flex items-center justify-between gap-2">
								<Input
									class="h-8 flex-1"
									bind:value={day.title}
									placeholder="Day {day.dayNo} — e.g. Heavy day"
									required
								/>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs text-destructive"
									onclick={() => {
										libEditing!.days.splice(i, 1);
										libEditing!.days.forEach((d2, j) => (d2.dayNo = j + 1));
									}}>Remove</Button
								>
							</div>
							<Textarea
								bind:value={day.body}
								placeholder="Back squat 5×5 · RDL 3×8 · Plank 3×60s"
								rows={2}
								required
							/>
						</div>
					{/each}
					<Button
						type="button"
						variant="outline"
						size="sm"
						class="w-full"
						onclick={() =>
							libEditing!.days.push({
								dayNo: libEditing!.days.length + 1,
								title: '',
								body: ''
							})}>Add day</Button
					>
				</div>
				<div class="flex justify-end gap-2">
					<Button type="button" variant="outline" onclick={() => (libEditing = null)}>Back</Button>
					<Button type="submit">Save program</Button>
				</div>
			</form>
		{:else}
			<div class="space-y-2">
				{#each programs as p (p.program.id)}
					<div class="flex items-center justify-between gap-2 rounded-md border p-3 text-sm">
						<div class="min-w-0">
							<p class="truncate font-medium">{p.program.name}</p>
							<p class="text-xs text-muted-foreground">
								{p.program.weeks} week{p.program.weeks === 1 ? '' : 's'} · {p.days.length} days{p
									.program.note
									? ` — ${p.program.note}`
									: ''}
							</p>
						</div>
						<span class="flex shrink-0 gap-1">
							<Button
								variant="ghost"
								size="sm"
								class="h-7 px-2 text-xs"
								onclick={() => openProgram(p)}>Edit</Button
							>
							<Button
								variant="ghost"
								size="sm"
								class="h-7 px-2 text-xs text-destructive"
								onclick={async () => {
									if (!confirm(`Delete "${p.program.name}"?`)) return;
									await removeProgram(p.program.id);
									toast.success('Deleted');
								}}>Delete</Button
							>
						</span>
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No programs yet.</p>
				{/each}
				<Button size="sm" variant="outline" class="w-full" onclick={() => openProgram()}
					><Plus /> New program</Button
				>
			</div>
		{/if}
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
