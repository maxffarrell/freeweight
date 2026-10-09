<script lang="ts">
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { Progress } from '#lib/components/ui/progress/index.js';
	import Trophy from '@lucide/svelte/icons/trophy';
	import Star from '@lucide/svelte/icons/star';
	import { Input } from '#lib/components/ui/input/index.js';
	import { Checkbox } from '#lib/components/ui/checkbox/index.js';
	import StatusBadge from '#lib/components/app/status-badge.svelte';
	import Whiteboard from '#lib/components/app/whiteboard.svelte';
	import { toast } from 'svelte-sonner';
	import {
		getPortalOverview,
		getBookable,
		memberBook,
		memberBookSeries,
		memberCancel,
		memberMove,
		requestMembershipCancel,
		requestMembershipPause,
		withdrawMembershipPause,
		withdrawMembershipCancel,
		getProviders,
		startCheckout,
		signWaiver,
		getMyDocuments,
		getMeasurements,
		logMeasurement,
		removeMeasurement,
		resubscribe,
		getJoinablePlans,
		joinPlan,
		buyPack,
		changePlan,
		updateProfile,
		getPortalResources,
		getResourceDay,
		bookResource,
		cancelReservation,
		getReservations,
		getPtCoaches,
		getMyPtRequests,
		requestPt,
		getAmenityRules,
		repeatAmenityWeekly,
		cancelAmenityRule,
		getPortalEvents,
		registerEvent,
		cancelEventReg,
		getPortalCourses,
		enrollCourse,
		leaveCourse,
		dropCourseSession,
		rebookCourseSession,
		checkInWithCode,
		getPortalChallenges,
		joinChallenge,
		leaveChallenge,
		getPortalAnnouncements,
		addDependent,
		getPortalAi,
		aiWorkoutPlan,
		redeemGiftCard,
		rateSession,
		setVisitGoal,
		logWorkoutResult,
		acceptSaveOffer,
		requestAddonRemoval,
		getShopItems,
		buyShopItem,
		getPersonalRecords,
		addPersonalRecord,
		deletePersonalRecord,
		getPrBoard,
		getSignRequests,
		signDocument,
		getMovementVideos,
		setPackAutoRenew,
		getMyWorkouts,
		giftPackCredits,
		getMyDataExport,
		getNpsStatus,
		submitNps
	} from '#lib/remote/portal.remote.ts';
	import { errMsg, formatDate, formatMoney } from '#lib/format.ts';
	import { localDate, localTime } from '#lib/tz.ts';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Check from '@lucide/svelte/icons/check';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import FileText from '@lucide/svelte/icons/file-text';
	import Flame from '@lucide/svelte/icons/flame';
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import Dumbbell from '@lucide/svelte/icons/dumbbell';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Copy from '@lucide/svelte/icons/copy';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import ShoppingBag from '@lucide/svelte/icons/shopping-bag';
	import * as Field from '#lib/components/ui/field/index.js';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { NativeSelect } from '#lib/components/ui/native-select/index.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const memberId = $derived(data.memberId);

	// ------- data export -------
	let exportPending = $state(false);
	async function downloadMyData() {
		exportPending = true;
		try {
			const data = await getMyDataExport(memberId);
			const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `freeweight-data-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(a.href);
		} catch (err) {
			toast.error(errMsg(err, 'Could not export'));
		}
		exportPending = false;
	}

	// ------- gift pack classes -------
	let giftOpen = $state(false);
	let giftEmail = $state('');
	let giftCredits = $state('1');
	let giftPending = $state(false);
	async function sendGift(e: SubmitEvent) {
		e.preventDefault();
		giftPending = true;
		try {
			const r = await giftPackCredits({
				memberId,
				email: giftEmail.trim(),
				credits: parseInt(giftCredits) || 0
			});
			const n = parseInt(giftCredits) || 0;
			toast.success(`${n} class${n === 1 ? '' : 'es'} sent to ${r.toName}`);
			giftOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not gift classes'));
		}
		giftPending = false;
	}

	let rateFor = $state<{ sessionId: string; className: string } | null>(null);
	let rateValue = $state(0);
	let rateComment = $state('');
	let rateBusy = $state(false);

	// Workout result logging — score + "as Rx" on attended sessions that have a WOD.
	let resultFor = $state<{ sessionId: string; className: string } | null>(null);
	let resultScore = $state('');
	let resultRx = $state(false);
	let resultBusy = $state(false);
	function openResult(h: { sessionId: string; className: string }) {
		resultFor = { sessionId: h.sessionId, className: h.className };
		const r = d.results[h.sessionId];
		resultScore = r?.score ?? '';
		resultRx = r?.asRx ?? false;
	}
	async function submitResult() {
		if (!resultFor || !resultScore.trim()) return;
		resultBusy = true;
		try {
			await logWorkoutResult({
				memberId,
				sessionId: resultFor.sessionId,
				score: resultScore.trim(),
				asRx: resultRx
			});
			toast.success('Score logged');
			resultFor = null;
		} catch (err) {
			toast.error(errMsg(err, 'Could not log score'));
		}
		resultBusy = false;
	}

	function openRate(h: { sessionId: string; className: string }) {
		rateFor = { sessionId: h.sessionId, className: h.className };
		const fb = d.feedback[h.sessionId];
		rateValue = fb?.rating ?? 0;
		rateComment = fb?.comment ?? '';
	}

	async function submitRating() {
		if (!rateFor || !rateValue) return;
		rateBusy = true;
		try {
			await rateSession({
				memberId,
				sessionId: rateFor.sessionId,
				rating: rateValue,
				comment: rateComment.trim() || undefined
			});
			toast.success('Thanks for the feedback!');
			rateFor = null;
		} catch (err) {
			toast.error(errMsg(err, 'Could not save rating'));
		}
		rateBusy = false;
	}
	const d = $derived(await getPortalOverview(memberId));
	const npsStatus = $derived(await getNpsStatus(memberId));
	const npsDue = $derived(npsStatus.due);
	let npsScore = $state<number | null>(null);
	let npsComment = $state('');
	let npsPending = $state(false);
	let npsSent = $state(false);
	let npsFor = $state(memberId);
	$effect(() => {
		if (memberId !== npsFor) {
			npsFor = memberId;
			npsSent = false;
			npsScore = null;
			npsComment = '';
		}
	});
	async function sendNps() {
		if (npsScore == null) return;
		npsPending = true;
		try {
			await submitNps({ memberId, score: npsScore, comment: npsComment || undefined });
			npsSent = true;
		} catch (err) {
			toast.error(errMsg(err, 'Could not send'));
		}
		npsPending = false;
	}
	let avatarInput = $state<HTMLInputElement>();
	let photoBusy = $state(false);

	// ------- gift cards -------
	let gcCode = $state('');
	let gcBusy = $state(false);
	async function askRemoveAddon(addOnId: string) {
		if (!confirm('Ask the front desk to stop this add-on? They will confirm before it ends.'))
			return;
		try {
			await requestAddonRemoval({ memberId, addOnId });
			toast.success('Removal requested');
		} catch (err) {
			toast.error(errMsg(err, 'Could not request'));
		}
	}

	async function redeemCard() {
		if (gcBusy || !gcCode.trim()) return;
		gcBusy = true;
		try {
			const r = await redeemGiftCard({ memberId, code: gcCode });
			toast.success(`Applied ${formatMoney(r.applied, currency)} to your account`);
			gcCode = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not redeem that code'));
		}
		gcBusy = false;
	}
	async function editGoal() {
		const v = prompt(
			'How many visits this month are you aiming for? (1–60, blank clears)',
			d.member.goalVisitsPerMonth ? String(d.member.goalVisitsPerMonth) : '12'
		);
		if (v === null) return;
		const goal = v.trim() === '' ? null : Number(v);
		if (goal !== null && (!Number.isInteger(goal) || goal < 1 || goal > 60)) {
			toast.error('Pick a number of visits between 1 and 60');
			return;
		}
		try {
			await setVisitGoal({ memberId, goal });
			toast.success(goal ? `Goal set: ${goal} visits` : 'Goal cleared');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save your goal'));
		}
	}
	async function uploadPhoto(file: File | null | undefined) {
		if (!file || photoBusy) return;
		photoBusy = true;
		const body = new FormData();
		body.append('memberId', memberId);
		body.append('file', file);
		const res = await fetch('/api/portal/photo', { method: 'POST', body });
		photoBusy = false;
		if (!res.ok) {
			toast.error((await res.json().catch(() => null))?.message ?? 'Upload failed');
			return;
		}
		toast.success('Photo updated');
		await getPortalOverview(memberId).refresh();
		if (avatarInput) avatarInput.value = '';
	}
	const bookable = $derived(await getBookable(memberId));
	const providers = $derived(await getProviders(memberId));
	const docs = $derived(await getMyDocuments(memberId));
	const joinablePlans = $derived(await getJoinablePlans(memberId));
	const portalAi = $derived(await getPortalAi());

	// ------- AI workout plan (Enterprise) -------
	let wpOpen = $state(false);
	let wpGoal = $state('');
	let wpDays = $state(3);
	let wpMinutes = $state(45);
	let wpNotes = $state('');
	let wpPending = $state(false);
	let wpResult = $state<{ title: string; plan: string } | null>(null);
	async function submitWorkoutPlan(e: SubmitEvent) {
		e.preventDefault();
		wpPending = true;
		try {
			wpResult = await aiWorkoutPlan({
				memberId,
				goal: wpGoal,
				daysPerWeek: wpDays,
				minutesPerSession: wpMinutes,
				notes: wpNotes || undefined
			});
			wpOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not generate a plan'));
		}
		wpPending = false;
	}

	// ------- amenity reservations -------
	const amenities = $derived(await getPortalResources(memberId));
	const reservations = $derived(await getReservations(memberId));
	const amenityRules = $derived(await getAmenityRules(memberId));
	const ptCoaches = $derived(await getPtCoaches(memberId));
	const myPt = $derived(await getMyPtRequests(memberId));
	let ptCoach = $state('');
	let ptAt = $state('');
	let ptNote = $state('');
	let ptBusy = $state(false);
	async function sendPtRequest() {
		if (!ptAt) return toast.error('Pick a date and time');
		ptBusy = true;
		try {
			await requestPt({
				memberId,
				instructorId: ptCoach || undefined,
				preferredAt: ptAt,
				note: ptNote || undefined
			});
			toast.success('Request sent — the gym will confirm your slot');
			ptAt = '';
			ptNote = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not send the request'));
		}
		ptBusy = false;
	}
	let amenityId = $state('');
	const amenity = $derived(
		amenities.find((a) => a.resource.id === amenityId) ?? amenities[0] ?? null
	);
	let amenityDay = $state('');
	const amenitySlots = $derived(
		amenity && amenityDay
			? await getResourceDay({ memberId, resourceId: amenity.resource.id, day: amenityDay })
			: null
	);
	let amenityBusy = $state(0);
	async function bookAmenity(startsAt: Date) {
		if (!amenity) return;
		amenityBusy = startsAt.getTime();
		try {
			await bookResource({
				memberId,
				resourceId: amenity.resource.id,
				day: amenityDay,
				time: localTime(startsAt, tz)
			});
			toast.success(`${amenity.resource.name} booked`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		amenityBusy = 0;
	}
	async function cancelRes(id: string) {
		try {
			await cancelReservation({ memberId, id });
			toast.success('Reservation cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
	}

	// ------- events -------
	const portalEvents = $derived(await getPortalEvents(memberId));
	let evBusy = $state('');
	async function registerEv(eventId: string) {
		evBusy = eventId;
		try {
			const r = await registerEvent({ memberId, eventId });
			toast.success(
				r.registration.waitlisted
					? `Added to the ${r.event.name} waitlist — we'll email you if a spot opens`
					: r.registration.chargeId
						? `Registered — ${formatMoney(r.event.price ?? 0, currency)} added to your balance`
						: `You're registered for ${r.event.name}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not register'));
		}
		evBusy = '';
	}
	async function cancelEv(regId: string) {
		try {
			await cancelEventReg({ memberId, id: regId });
			toast.success('Registration cancelled');
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
	}

	// ------- courses -------
	const portalCourses = $derived(await getPortalCourses(memberId));
	let cBusy = $state('');
	async function joinCourse(courseId: string) {
		cBusy = courseId;
		try {
			const r = await enrollCourse({ memberId, courseId });
			toast.success(
				r.charge
					? `Enrolled — ${formatMoney(r.charge.amount, currency)} added to your balance`
					: `Enrolled — booked into ${r.booked} session${r.booked === 1 ? '' : 's'}${r.waitlisted ? `, waitlisted on ${r.waitlisted}` : ''}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not enroll'));
		}
		cBusy = '';
	}
	async function quitCourse(courseId: string) {
		cBusy = courseId;
		try {
			await leaveCourse({ memberId, courseId });
			toast.success('Left the course — upcoming spots released');
		} catch (err) {
			toast.error(errMsg(err, 'Could not leave the course'));
		}
		cBusy = '';
	}
	async function dropSess(bookingId: string) {
		cBusy = bookingId;
		try {
			await dropCourseSession({ memberId, bookingId });
			toast.success('Dropped — you can re-book that session anytime');
		} catch (err) {
			toast.error(errMsg(err, 'Could not drop the session'));
		}
		cBusy = '';
	}
	async function rebookSess(bookingId: string) {
		cBusy = bookingId;
		try {
			const b = await rebookCourseSession({ memberId, bookingId });
			toast.success(
				b.status === 'waitlisted' ? 'Session filled — you are waitlisted' : 'Re-booked'
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not re-book'));
		}
		cBusy = '';
	}

	// ------- challenges -------
	const portalChallenges = $derived(await getPortalChallenges(memberId));
	const news = $derived(await getPortalAnnouncements(memberId));
	let chalBusy = $state('');
	async function joinChal(challengeId: string) {
		chalBusy = challengeId;
		try {
			await joinChallenge({ memberId, challengeId });
			toast.success("You're in — every check-in counts");
		} catch (err) {
			toast.error(errMsg(err, 'Could not join'));
		}
		chalBusy = '';
	}
	async function leaveChal(challengeId: string) {
		chalBusy = challengeId;
		try {
			await leaveChallenge({ memberId, challengeId });
			toast.success('Left the challenge');
		} catch (err) {
			toast.error(errMsg(err, 'Could not leave'));
		}
		chalBusy = '';
	}

	// ------- shop -------
	const shopItems = $derived(await getShopItems(memberId));
	let shopBusy = $state('');
	async function buyItem(itemId: string) {
		shopBusy = itemId;
		try {
			await buyShopItem({ memberId, itemId });
			toast.success('Added to your tab — pick it up at the desk');
		} catch (err) {
			toast.error(errMsg(err, 'Could not buy'));
		}
		shopBusy = '';
	}

	// ------- signature requests -------
	const signRequests = $derived(await getSignRequests(memberId));
	const pendingSigns = $derived(signRequests.filter((r) => r.status === 'pending'));
	let signFor = $state<(typeof signRequests)[number] | null>(null);
	let signName = $state('');
	let signBusy = $state(false);
	async function doSign() {
		if (!signFor || signName.trim().length < 2) return;
		signBusy = true;
		try {
			await signDocument({ memberId, requestId: signFor.id, signedName: signName.trim() });
			signFor = null;
			signName = '';
			toast.success('Signed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not sign'));
		}
		signBusy = false;
	}

	// ------- movement library -------
	const movementVideos = $derived(await getMovementVideos(memberId));

	async function toggleAutoRenew(msId: string, on: boolean) {
		try {
			await setPackAutoRenew({ memberId, membershipId: msId, on });
			toast.success(on ? 'Pack will auto-renew' : 'Auto-renew off');
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- personal records -------
	const prs = $derived(await getPersonalRecords(memberId));
	const prBoard = $derived(await getPrBoard(memberId));
	let prLabel = $state('');
	let prValue = $state('');
	let prDate = $state('');
	let prBusy = $state(false);
	async function addPr(e: SubmitEvent) {
		e.preventDefault();
		if (!prLabel.trim() || !prValue.trim()) return;
		prBusy = true;
		try {
			await addPersonalRecord({
				memberId,
				label: prLabel.trim(),
				value: prValue.trim(),
				...(prDate ? { recordedOn: prDate } : {})
			});
			prLabel = prValue = prDate = '';
			await Promise.all([getPersonalRecords(memberId).refresh(), getPrBoard(memberId).refresh()]);
			toast.success('PR logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		prBusy = false;
	}
	async function delPr(prId: string) {
		try {
			await deletePersonalRecord({ memberId, prId });
			await Promise.all([getPersonalRecords(memberId).refresh(), getPrBoard(memberId).refresh()]);
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- class check-in code -------
	let code = $state('');
	let codeBusy = $state(false);
	async function submitCode(e: SubmitEvent) {
		e.preventDefault();
		if (!code.trim()) return;
		codeBusy = true;
		try {
			const r = await checkInWithCode({ memberId, code });
			code = '';
			toast.success(
				r.already ? `Already checked in to ${r.className}` : `Checked in to ${r.className}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Invalid code'));
		}
		codeBusy = false;
	}
	const planFull = (p: (typeof joinablePlans)[number]) =>
		!p.isPack && p.memberLimit !== null && p.activeMembers >= p.memberLimit;

	// ------- progress tracking -------
	const measurements = $derived(await getMeasurements(memberId));
	const KIND_LABELS = {
		weight: 'Weight',
		body_fat: 'Body fat',
		waist: 'Waist',
		chest: 'Chest'
	} as const;
	const UNITS = ['lb', 'kg', '%', 'in', 'cm'] as const;
	let msKind = $state<keyof typeof KIND_LABELS>('weight');
	let msValue = $state('');
	let msUnit = $state<(typeof UNITS)[number]>('lb');
	let msDate = $state('');
	let msPending = $state(false);
	/** Entries come newest-first; the next same-kind+unit row is the previous reading. */
	const statDelta = (e: (typeof measurements)[number]) => {
		const prev = measurements
			.slice(measurements.indexOf(e) + 1)
			.find((x) => x.kind === e.kind && x.unit === e.unit);
		return prev ? e.value - prev.value : null;
	};
	async function logStat(e: SubmitEvent) {
		e.preventDefault();
		msPending = true;
		try {
			await logMeasurement({
				memberId,
				kind: msKind,
				value: Number(msValue),
				unit: msUnit as (typeof UNITS)[number],
				recordedAt: msDate || undefined
			});
			msValue = '';
			toast.success('Logged');
		} catch (err) {
			toast.error(errMsg(err, 'Could not log'));
		}
		msPending = false;
	}
	async function removeStat(id: string) {
		try {
			await removeMeasurement({ memberId, id });
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}
	/** Packs the member doesn't already hold — buyable alongside a normal plan. */
	const hasPlan = $derived(
		d.memberships.some((mm) => mm.membership.status === 'active') || d.guardianHasMembership
	);
	const myWorkouts = $derived(await getMyWorkouts(memberId));

	const buyablePacks = $derived(
		joinablePlans.filter(
			(p) =>
				p.isPack &&
				!d.memberships.some((mm) => mm.plan.id === p.id && mm.membership.status === 'active')
		)
	);
	let joining = $state('');
	async function join(planId: string) {
		joining = planId;
		try {
			await joinPlan({ memberId, planId });
			toast.success('Membership activated — pay any open balance below');
		} catch (err) {
			toast.error(errMsg(err, 'Could not join plan'));
		}
		joining = '';
	}
	async function buy(planId: string) {
		joining = planId;
		try {
			await buyPack({ memberId, planId });
			toast.success('Pack added — pay it off below');
		} catch (err) {
			toast.error(errMsg(err, 'Could not buy the pack'));
		}
		joining = '';
	}
	let changeOpen = $state(false);
	let profileOpen = $state(false);
	let pName = $state('');
	let pPhone = $state('');
	let pBirthday = $state('');
	let pSaving = $state(false);
	function openProfile() {
		pName = d.member.name;
		pPhone = d.member.phone ?? '';
		pBirthday = d.member.birthday ?? '';
		profileOpen = !profileOpen;
	}
	async function saveProfile(e: SubmitEvent) {
		e.preventDefault();
		pSaving = true;
		try {
			await updateProfile({
				memberId,
				name: pName,
				phone: pPhone || null,
				birthday: pBirthday || null
			});
			toast.success('Profile updated');
			profileOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not update profile'));
		}
		pSaving = false;
	}
	async function switchPlan(planId: string) {
		joining = planId;
		try {
			const r = await changePlan({ memberId, planId });
			toast.success(
				r.prorated > 0
					? `Plan updated — a ${formatMoney(r.prorated, currency)} proration is on your balance`
					: r.prorated < 0
						? `Plan updated — ${formatMoney(-r.prorated, currency)} credit applied`
						: 'Plan updated — your next bill reflects the new price'
			);
			changeOpen = false;
		} catch (err) {
			toast.error(errMsg(err, 'Could not change plan'));
		}
		joining = '';
	}
	const tz = $derived(d.settings?.timezone ?? 'UTC');
	const currency = $derived(d.settings?.currency ?? 'usd');
	const refLink = $derived(`${page.url.origin}/j/${d.orgSlug}?ref=${memberId}`);
	function copyRefLink() {
		navigator.clipboard
			.writeText(refLink)
			.then(() => toast.success('Referral link copied'))
			.catch(() => toast.error('Could not copy'));
	}

	let qrUrl = $state('');
	$effect(() => {
		const code = d.checkInCode;
		void import('qrcode').then((QRCode) =>
			QRCode.toDataURL(code, { width: 240, margin: 1 }).then((u: string) => (qrUrl = u))
		);
	});

	let paying = $state(false);
	onMount(() => {
		if (page.url.searchParams.get('paid') === '1') {
			toast.success('Thanks! Your payment was received.');
			void goto('/portal', { shallow: true, replace: true });
		}
	});
	async function pay(provider: string) {
		paying = true;
		try {
			const { url } = await startCheckout({ memberId, provider });
			location.assign(url);
		} catch (err) {
			paying = false;
			toast.error(errMsg(err, 'Could not start payment'));
		}
	}

	let signingWaiver = $state(false);
	async function sign() {
		signingWaiver = true;
		try {
			await signWaiver(memberId);
			toast.success('Waiver signed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not sign'));
		}
		signingWaiver = false;
	}

	const obItems = $derived.by(() => [
		{
			label: 'Sign your waiver',
			done: d.onboarding.waiver,
			action: 'Sign',
			fn: () =>
				document
					.getElementById('portal-waiver')
					?.scrollIntoView({ behavior: 'smooth', block: 'center' })
		},
		{
			label: 'Add a profile photo',
			done: d.onboarding.photo,
			action: 'Upload',
			fn: () => avatarInput?.click()
		},
		{
			label: 'Set a monthly visit goal',
			done: d.onboarding.goal,
			action: 'Set goal',
			fn: editGoal
		},
		{
			label: 'Book your first class',
			done: d.onboarding.booked,
			action: 'Browse',
			fn: () =>
				document
					.getElementById('portal-book')
					?.scrollIntoView({ behavior: 'smooth', block: 'start' })
		},
		{ label: 'Check in at the front desk', done: d.onboarding.visited, action: null, fn: null }
	]);
	const obDoneCount = $derived(obItems.filter((i) => i.done).length);

	let busy = $state<string | null>(null);
	// Guests the member wants to bring to each session (guest passes / drop-in priced).
	let guestPick = $state<Record<string, string>>({});
	async function book(sessionId: string) {
		busy = sessionId;
		try {
			const guests = Number(guestPick[sessionId] ?? 0) || 0;
			const b = await memberBook({ memberId, sessionId, guests });
			toast.success(b.status === 'waitlisted' ? 'Class full — you are on the waitlist' : 'Booked!');
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		busy = null;
	}
	async function rebook(classTypeId: string) {
		const next = bookable.find((b) => b.session.classTypeId === classTypeId && !b.myStatus);
		if (!next) {
			toast.error('No upcoming sessions');
			return;
		}
		busy = `rebook:${classTypeId}`;
		try {
			const b = await memberBook({ memberId, sessionId: next.session.id });
			toast.success(
				b.status === 'waitlisted'
					? 'Class full — you are on the waitlist'
					: `Booked ${next.className} ${localDate(next.session.startsAt, tz)}`
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not book'));
		}
		busy = null;
	}
	const nextOfType = (classTypeId: string) =>
		bookable.find((b) => b.session.classTypeId === classTypeId && !b.myStatus);
	async function bookSeriesAll(classTypeId: string, className: string) {
		if (!confirm(`Book into every upcoming ${className} session?`)) return;
		busy = `series:${classTypeId}`;
		try {
			const r = await memberBookSeries({ memberId, classTypeId });
			const parts = [`Booked ${r.booked}`];
			if (r.waitlisted) parts.push(`waitlisted ${r.waitlisted}`);
			if (r.skipped) parts.push(`skipped ${r.skipped}`);
			toast.success(parts.join(' · '));
		} catch (err) {
			toast.error(errMsg(err, 'Could not book the series'));
		}
		busy = null;
	}

	async function cancel(bookingId: string, sessionId: string) {
		busy = sessionId;
		try {
			const b = await memberCancel({ memberId, bookingId });
			toast.success(
				b.lateFeeApplied
					? 'Cancelled — a late-cancel fee was charged'
					: b.lateFeeForgiven
						? 'Cancelled late — free late cancel used, no fee'
						: 'Booking cancelled'
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not cancel'));
		}
		busy = null;
	}

	const CANCEL_REASONS = [
		'Too expensive',
		'Moving',
		'Injury or health',
		'Too busy',
		'Schedule conflicts',
		'Other'
	];
	let cancelReqId = $state('');
	let requestReason = $state('');
	async function requestCancel(membershipId: string) {
		try {
			await requestMembershipCancel({
				memberId,
				membershipId,
				reason: requestReason || undefined
			});
			toast.success('Cancellation requested — staff will confirm');
			cancelReqId = '';
			requestReason = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not request'));
		}
	}
	let offerBusy = $state(false);
	async function takeSaveOffer() {
		offerBusy = true;
		try {
			const r = await acceptSaveOffer(memberId);
			toast.success(`Done — ${formatMoney(r.credit)} off your next bill`);
			cancelReqId = '';
			requestReason = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not apply the offer'));
		}
		offerBusy = false;
	}
	async function withdrawCancel(membershipId: string) {
		try {
			await withdrawMembershipCancel({ memberId, membershipId });
			toast.success('Request withdrawn');
		} catch (err) {
			toast.error(errMsg(err, 'Could not withdraw'));
		}
	}
	let pauseReqId = $state('');
	let pauseResumeOn = $state('');
	async function requestPause(e: SubmitEvent) {
		e.preventDefault();
		try {
			await requestMembershipPause({
				memberId,
				membershipId: pauseReqId,
				resumeOn: pauseResumeOn,
				reason: requestReason || undefined
			});
			toast.success('Pause requested — staff will confirm');
			pauseReqId = '';
			pauseResumeOn = '';
			requestReason = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not request'));
		}
	}
	async function withdrawPause(membershipId: string) {
		try {
			await withdrawMembershipPause({ memberId, membershipId });
			toast.success('Request withdrawn');
		} catch (err) {
			toast.error(errMsg(err, 'Could not withdraw'));
		}
	}
	const myBookingId = (b: (typeof bookable)[number]) =>
		d.upcoming.find((u) => u.booking.sessionId === b.session.id && u.booking.status !== 'cancelled')
			?.booking.id;

	// ------- move booking (swap class) -------
	let moveOpen = $state(false);
	let moveFrom = $state<(typeof bookable)[number] | null>(null);
	const moveTargets = $derived(
		moveFrom
			? bookable.filter(
					(c) =>
						c.session.id !== moveFrom!.session.id &&
						c.memberBookable &&
						(!c.myStatus || c.myStatus === 'cancelled') &&
						c.booked < c.session.capacity
				)
			: []
	);
	async function moveTo(sessionId: string) {
		const bookingId = moveFrom ? myBookingId(moveFrom) : null;
		if (!bookingId) return;
		busy = `move:${sessionId}`;
		try {
			await memberMove({ memberId, bookingId, sessionId });
			toast.success('Moved — see you there');
			moveOpen = false;
			moveFrom = null;
		} catch (err) {
			toast.error(errMsg(err, 'Could not move the booking'));
		}
		busy = null;
	}

	// ------- family members -------
	let depOpen = $state(false);
	let depName = $state('');
	let depBirthday = $state('');
	let depPending = $state(false);
	async function submitDependent(e: SubmitEvent) {
		e.preventDefault();
		depPending = true;
		try {
			const r = await addDependent({
				memberId,
				name: depName,
				birthday: depBirthday || undefined
			});
			depOpen = false;
			depName = '';
			depBirthday = '';
			toast.success(`${r.member.name} added — manage them from the member switcher`);
			await goto(`/portal?m=${r.member.id}`, { invalidateAll: true });
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		}
		depPending = false;
	}

	let resubscribing = $state(false);
	async function reenableEmails() {
		resubscribing = true;
		try {
			await resubscribe(memberId);
			toast.success("You're back on the email list");
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
		resubscribing = false;
	}
</script>

<svelte:head><title>Member portal</title></svelte:head>

{#if d.settings.logoDocumentId}
	<img src="/api/logo/{d.settings.logoDocumentId}" alt="" class="mb-4 h-10 w-auto object-contain" />
{/if}

<div class="mb-4 flex items-center gap-3">
	{#if data.options.length > 1}
		<NativeSelect
			onchange={(e) => goto(`/portal?m=${e.currentTarget.value}`, { invalidateAll: true })}
		>
			{#each data.options as o (o.memberId)}
				<option value={o.memberId} selected={o.memberId === memberId}>{o.label}</option>
			{/each}
		</NativeSelect>
	{/if}
	{#if !data.options.find((o) => o.memberId === memberId)?.dependent}
		<button
			class="text-sm text-muted-foreground underline-offset-4 hover:underline"
			onclick={() => (depOpen = true)}>Add a family member</button
		>
	{/if}
</div>

{#if d.settings.portalNotice}
	<div
		class="mb-4 rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm dark:border-sky-900 dark:bg-sky-950/40"
	>
		{d.settings.portalNotice}
	</div>
{/if}

{#if d.member.unsubscribedAt}
	<div
		class="mb-4 flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm dark:border-amber-900 dark:bg-amber-950/40"
	>
		<span>You're not receiving emails from the gym.</span>
		<Button size="sm" variant="outline" disabled={resubscribing} onclick={reenableEmails}
			>{resubscribing ? 'Turning on…' : 'Turn emails back on'}</Button
		>
	</div>
{/if}

<div class="grid gap-4 sm:grid-cols-2">
	<Card.Root class="sm:col-span-2">
		<Card.Content class="flex flex-col items-center gap-4 p-6 text-center sm:flex-row sm:text-left">
			{#if qrUrl}
				<img
					src={qrUrl}
					alt="Your check-in QR code"
					class="size-36 rounded-lg border bg-white p-2"
				/>
			{:else}
				<div class="size-36 animate-pulse rounded-lg bg-muted"></div>
			{/if}
			<div class="flex items-center gap-4">
				<input
					bind:this={avatarInput}
					type="file"
					accept="image/png,image/jpeg,image/webp,image/gif"
					class="hidden"
					onchange={(e) => uploadPhoto(e.currentTarget.files?.[0])}
				/>
				{#if d.member.photoDocumentId}
					<img
						src="/api/portal/documents/{d.member.photoDocumentId}?m={d.member.id}"
						alt={d.member.name}
						class="size-16 shrink-0 rounded-full object-cover"
					/>
				{/if}
				<div>
					<h1 class="text-xl font-semibold">Hi {d.member.name.split(' ')[0]}</h1>
					<p class="text-sm text-muted-foreground">Show this code at the front desk to check in.</p>
					<div class="mt-3 flex flex-wrap gap-1.5">
						{#if d.level}
							<Badge variant="secondary" class="gap-1.5">
								{#if d.level.color}<span
										class="size-2 rounded-full"
										style:background={d.level.color}
									></span>{/if}
								{d.level.name}
							</Badge>
						{/if}
						{#each d.memberships as mm (mm.membership.id)}
							{#if mm.membership.status === 'active'}
								<Badge
									>{mm.plan.name}{mm.plan.isPack
										? ''
										: ` · ${formatMoney(mm.membership.price ?? mm.plan.amount, currency)}/${mm.plan.interval}`}</Badge
								>
							{/if}
						{/each}
						{#if !d.memberships.some((mm) => mm.membership.status === 'active')}
							<Badge variant="secondary">No active membership</Badge>
						{/if}
						{#if d.credits}
							<Badge variant="outline"
								>{d.credits.used} of {d.credits.limit}{d.credits.className
									? ` ${d.credits.className}`
									: ''} classes used</Badge
							>
							{#if d.credits.limit - d.credits.used > 0}
								<button
									class="text-xs text-muted-foreground underline"
									onclick={() => ((giftEmail = ''), (giftCredits = '1'), (giftOpen = true))}
									>Gift classes</button
								>
							{/if}
						{/if}
					</div>
					<p class="mt-1 text-xs">
						<button class="text-muted-foreground underline" onclick={openProfile}
							>Edit profile</button
						>
						·
						<button
							class="text-muted-foreground underline"
							disabled={exportPending}
							onclick={downloadMyData}>{exportPending ? 'Exporting…' : 'Download my data'}</button
						>
						·
						<button
							class="text-muted-foreground underline"
							disabled={photoBusy}
							onclick={() => avatarInput?.click()}
							>{photoBusy
								? 'Uploading…'
								: d.member.photoDocumentId
									? 'Change photo'
									: 'Add photo'}</button
						>
					</p>
					{#if profileOpen}
						<form class="mt-1 w-full max-w-xs space-y-2" onsubmit={saveProfile}>
							<Input bind:value={pName} required placeholder="Name" class="h-8 text-sm" />
							<Input bind:value={pPhone} placeholder="Phone" class="h-8 text-sm" />
							<Input bind:value={pBirthday} type="date" aria-label="Birthday" class="h-8 text-sm" />
							<div class="flex gap-2">
								<Button size="sm" class="h-7 px-3 text-xs" type="submit" disabled={pSaving}
									>{pSaving ? 'Saving…' : 'Save'}</Button
								>
								<Button
									size="sm"
									variant="outline"
									class="h-7 px-3 text-xs"
									type="button"
									onclick={() => (profileOpen = false)}>Cancel</Button
								>
							</div>
							<p class="text-xs text-muted-foreground">Email changes go through the front desk.</p>
						</form>
					{/if}
					{#if !d.memberships.some((mm) => mm.membership.status === 'active') && joinablePlans.length}
						<div class="mt-2 w-full space-y-1.5">
							<p class="text-xs font-medium text-muted-foreground">Join a plan</p>
							{#each joinablePlans as p (p.id)}
								<div class="flex items-center justify-between gap-2 text-sm">
									<div class="min-w-0">
										<span class="font-medium">{p.name}</span>
										<span class="text-muted-foreground">
											— {formatMoney(p.amount, currency)}{p.isPack
												? ` · ${p.classCredits} classes${p.packClassName ? ` (${p.packClassName} only)` : ''}`
												: `/${p.interval}`}{p.trialDays
												? ` · ${p.trialDays}-day free trial`
												: ''}{p.commitmentMonths ? ` · ${p.commitmentMonths}-mo minimum` : ''}
										</span>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={joining === p.id || planFull(p)}
										onclick={() => join(p.id)}
										>{planFull(p) ? 'Full' : joining === p.id ? 'Joining…' : 'Join'}</Button
									>
								</div>
							{/each}
						</div>
					{/if}
					{#if d.memberships.some((mm) => mm.membership.status === 'active') && buyablePacks.length}
						<div class="mt-2 w-full space-y-1.5">
							<p class="text-xs font-medium text-muted-foreground">Class packs</p>
							{#each buyablePacks as p (p.id)}
								<div class="flex items-center justify-between gap-2 text-sm">
									<div class="min-w-0">
										<span class="font-medium">{p.name}</span>
										<span class="text-muted-foreground">
											— {formatMoney(p.amount, currency)} · {p.classCredits} classes{p.packClassName
												? ` · ${p.packClassName} only`
												: ''}{p.packDays ? ` · expires in ${p.packDays} days` : ''}
										</span>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={joining === p.id}
										onclick={() => buy(p.id)}>{joining === p.id ? 'Adding…' : 'Buy'}</Button
									>
								</div>
							{/each}
						</div>
					{/if}
					{#each d.memberships as mm (mm.membership.id)}
						{#if mm.membership.status === 'active'}
							<p class="mt-1 text-xs text-muted-foreground">
								{#if mm.membership.cancelRequestedAt}
									{mm.plan.name}: cancellation requested — staff will confirm shortly.
									<button class="underline" onclick={() => withdrawCancel(mm.membership.id)}
										>Withdraw request</button
									>
								{:else if mm.membership.pauseRequestedAt}
									{mm.plan.name}: pause requested{mm.membership.pauseUntil
										? ` until ${formatDate(mm.membership.pauseUntil)}`
										: ''} — staff will confirm shortly.
									<button class="underline" onclick={() => withdrawPause(mm.membership.id)}
										>Withdraw request</button
									>
								{:else}
									{#if !mm.plan.isPack && joinablePlans.some((p) => !p.isPack && p.id !== mm.plan.id)}
										<button class="underline" onclick={() => (changeOpen = !changeOpen)}
											>Change plan</button
										>
										·
									{/if}
									{#if !mm.plan.isPack}
										<button
											class="underline"
											onclick={() =>
												(pauseReqId = pauseReqId === mm.membership.id ? '' : mm.membership.id)}
											>Request pause</button
										>
										·
									{/if}
									{#if mm.plan.isPack}
										<button
											class="underline"
											onclick={() => toggleAutoRenew(mm.membership.id, !mm.membership.autoRenew)}
											>Auto-renew: {mm.membership.autoRenew ? 'on' : 'off'}</button
										>
										·
									{/if}
									<button
										class="underline"
										onclick={() =>
											(cancelReqId = cancelReqId === mm.membership.id ? '' : mm.membership.id)}
										>Request cancellation of {mm.plan.name}</button
									>
								{/if}
							</p>
							{#if pauseReqId === mm.membership.id}
								<form class="mt-1 flex flex-wrap items-center gap-2" onsubmit={requestPause}>
									<label class="text-xs text-muted-foreground" for="pause-date">Resume on</label>
									<Input
										id="pause-date"
										type="date"
										required
										class="h-7 w-auto text-xs"
										bind:value={pauseResumeOn}
									/>
									<NativeSelect bind:value={requestReason} size="sm">
										<option value="">Reason (optional)</option>
										{#each CANCEL_REASONS as r (r)}<option value={r}>{r}</option>{/each}
									</NativeSelect>
									<Button size="sm" variant="outline" class="h-7 px-2 text-xs" type="submit"
										>Request pause</Button
									>
								</form>
							{/if}
							{#if cancelReqId === mm.membership.id}
								<form
									class="mt-1 flex flex-wrap items-center gap-2"
									onsubmit={(e) => {
										e.preventDefault();
										void requestCancel(mm.membership.id);
									}}
								>
									<NativeSelect bind:value={requestReason} size="sm">
										<option value="">Reason (optional)</option>
										{#each CANCEL_REASONS as r (r)}<option value={r}>{r}</option>{/each}
									</NativeSelect>
									<Button size="sm" variant="outline" class="h-7 px-2 text-xs" type="submit"
										>Confirm cancellation request</Button
									>
									{#if d.settings.saveOfferPct && !mm.membership.saveOfferAt}
										<Button
											size="sm"
											variant="ghost"
											class="h-7 px-2 text-xs text-emerald-600 dark:text-emerald-400"
											type="button"
											disabled={offerBusy}
											onclick={takeSaveOffer}
											>Stay instead — {d.settings.saveOfferPct}% off your next bill</Button
										>
									{/if}
								</form>
							{/if}
						{/if}
					{/each}
					{#if changeOpen}
						<div class="mt-2 w-full space-y-1.5">
							<p class="text-xs font-medium text-muted-foreground">
								Switch plans — takes effect now, billed at your next charge
							</p>
							{#each joinablePlans.filter((p) => !p.isPack && !d.memberships.some((mm) => mm.plan.id === p.id && mm.membership.status === 'active')) as p (p.id)}
								<div class="flex items-center justify-between gap-2 text-sm">
									<div class="min-w-0">
										<span class="font-medium">{p.name}</span>
										<span class="text-muted-foreground">
											— {formatMoney(p.amount, currency)}/{p.interval}{p.classCredits
												? ` · ${p.classCredits} classes`
												: ''}{p.trialDays
												? ` · ${p.trialDays}-day free trial`
												: ''}{p.commitmentMonths ? ` · ${p.commitmentMonths}-mo minimum` : ''}
										</span>
									</div>
									<Button
										size="sm"
										variant="outline"
										disabled={joining === p.id || planFull(p)}
										onclick={() => switchPlan(p.id)}
										>{planFull(p) ? 'Full' : joining === p.id ? 'Switching…' : 'Switch'}</Button
									>
								</div>
							{/each}
						</div>
					{/if}
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header class="pb-2">
			<Card.Title class="text-base">Class check-in</Card.Title>
			<Card.Description>At class? Enter the code your coach announces.</Card.Description>
		</Card.Header>
		<Card.Content>
			<form class="flex gap-2" onsubmit={submitCode}>
				<Input
					class="w-28 text-center font-mono tracking-widest uppercase"
					placeholder="CODE"
					maxlength={8}
					bind:value={code}
				/>
				<Button type="submit" size="sm" disabled={codeBusy || code.trim().length < 4}
					>Check in</Button
				>
			</form>
		</Card.Content>
	</Card.Root>

	{#if amenities.length || reservations.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Amenities</Card.Title>
				<Card.Description>Book the sauna, court, or child care.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				{#if amenities.length}
					<div class="flex flex-wrap items-end gap-3">
						<div class="space-y-1">
							<label for="am-res" class="text-xs text-muted-foreground">Amenity</label>
							{#if amenities.length === 1}
								<p id="am-res" class="h-9 content-center text-sm font-medium">
									{amenity!.resource.name}
								</p>
							{:else}
								<NativeSelect id="am-res" bind:value={amenityId}>
									{#each amenities as a (a.resource.id)}
										<option value={a.resource.id}
											>{a.resource.name}{a.resource.status !== 'open'
												? ` (${a.resource.status === 'maintenance' ? 'maintenance' : 'closed'})`
												: ''}</option
										>
									{/each}
								</NativeSelect>
							{/if}
						</div>
						<div class="space-y-1">
							<label for="am-day" class="text-xs text-muted-foreground">Day</label>
							<Input
								id="am-day"
								type="date"
								min={localDate(new Date(), tz)}
								bind:value={amenityDay}
							/>
						</div>
					</div>
					{#if amenity && amenity.resource.status !== 'open'}
						<p class="text-sm font-medium text-amber-600 dark:text-amber-400">
							{amenity.resource.status === 'maintenance'
								? 'Down for maintenance'
								: 'Closed right now'}{amenity.resource.statusNote
								? ` — ${amenity.resource.statusNote}`
								: ''}
						</p>
					{:else if amenity && amenityDay}
						{#if amenitySlots?.slots.length}
							<div class="flex flex-wrap gap-2">
								{#each amenitySlots.slots as s (s.startsAt.getTime())}
									{@const full = s.taken >= amenitySlots.resource.capacity}
									{@const past = s.startsAt.getTime() <= Date.now()}
									<Button
										variant="outline"
										size="sm"
										disabled={full || past || amenityBusy > 0}
										onclick={() => bookAmenity(s.startsAt)}
									>
										{localTime(s.startsAt, tz)}{#if full}
											· full{:else if amenitySlots.resource.capacity > 1}
											· {amenitySlots.resource.capacity - s.taken} left{/if}
									</Button>
								{/each}
							</div>
						{:else if amenitySlots}
							<p class="text-sm text-muted-foreground">Not bookable that day.</p>
						{:else}
							<p class="text-sm text-muted-foreground">Loading…</p>
						{/if}
					{:else}
						<p class="text-sm text-muted-foreground">Pick a day to see open slots.</p>
					{/if}
				{/if}
				{#if amenityRules.length}
					<div class="mb-3 divide-y rounded-lg border border-emerald-500/30 bg-emerald-500/5">
						{#each amenityRules as rule (rule.rule.id)}
							<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
								<div>
									<span class="font-medium">{rule.resourceName}</span>
									<span class="text-muted-foreground">
										· every {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][rule.rule.weekday]} at
										{rule.rule.startTime}
									</span>
								</div>
								<Button
									variant="ghost"
									size="sm"
									onclick={async () => {
										try {
											await cancelAmenityRule({ memberId, ruleId: rule.rule.id });
											toast.success('Weekly reservation ended');
										} catch (err) {
											toast.error(errMsg(err, 'Failed'));
										}
									}}>End weekly</Button
								>
							</div>
						{/each}
					</div>
				{/if}
				{#if reservations.length}
					<div class="divide-y rounded-lg border">
						{#each reservations as r (r.booking.id)}
							<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
								<div>
									<span class="font-medium">{r.resourceName}</span>
									<span class="text-muted-foreground">
										· {localDate(r.booking.startsAt, tz)} at {localTime(r.booking.startsAt, tz)}
									</span>
								</div>
								<div class="flex items-center gap-1">
									<Button
										variant="ghost"
										size="sm"
										title="Reserve this slot every week"
										onclick={async () => {
											try {
												await repeatAmenityWeekly({ memberId, bookingId: r.booking.id });
												toast.success('Booked every week at this time');
											} catch (err) {
												toast.error(errMsg(err, 'Failed'));
											}
										}}>Weekly</Button
									>
									<Button variant="ghost" size="sm" onclick={() => cancelRes(r.booking.id)}
										>Cancel</Button
									>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if portalEvents.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Events</Card.Title>
				<Card.Description>Workshops, comps, and gym days — grab a spot.</Card.Description>
			</Card.Header>
			<Card.Content class="divide-y px-6 pb-4">
				{#each portalEvents as ev (ev.event.id)}
					{@const full = ev.registered >= ev.event.capacity}
					<div class="flex items-center gap-3 py-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate font-medium">{ev.event.name}</span>
								{#if ev.myRegistration}
									<Badge variant={ev.myRegistration.waitlisted ? 'secondary' : 'default'}>
										{ev.myRegistration.waitlisted ? 'Waitlist' : 'Registered'}
									</Badge>
								{/if}
							</div>
							<p class="text-sm text-muted-foreground">
								{formatDate(ev.event.startsAt)} · {localTime(ev.event.startsAt, tz)}
								{#if ev.locationName}· {ev.locationName}{/if}
								· {ev.registered}/{ev.event.capacity}
							</p>
							{#if ev.event.description}
								<p class="mt-0.5 truncate text-xs text-muted-foreground">
									{ev.event.description}
								</p>
							{/if}
						</div>
						{#if ev.myRegistration}
							<Button variant="ghost" size="sm" onclick={() => cancelEv(ev.myRegistration!.id)}
								>Cancel</Button
							>
						{:else}
							<Button
								size="sm"
								variant={full ? 'outline' : 'default'}
								disabled={evBusy === ev.event.id}
								onclick={() => registerEv(ev.event.id)}
							>
								{full
									? 'Join waitlist'
									: ev.event.price
										? `Register — ${formatMoney(ev.event.price, currency)}`
										: 'Register'}
							</Button>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if portalCourses.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Courses</Card.Title>
				<Card.Description>
					Multi-week programs — enroll once and you're booked into every session.
				</Card.Description>
			</Card.Header>
			<Card.Content class="divide-y px-6 pb-4">
				{#each portalCourses as c (c.course.id)}
					<div class="flex items-center gap-3 py-3">
						<div class="min-w-0 flex-1">
							<div class="flex items-center gap-2">
								<span class="truncate font-medium">{c.course.name}</span>
								{#if c.mine}
									<Badge>Enrolled</Badge>
								{:else if c.full}
									<Badge variant="outline">Full</Badge>
								{/if}
							</div>
							<p class="text-sm text-muted-foreground">
								{c.className}
								{c.schedule ? ` · ${c.schedule}` : ''}
								{#if c.locationName}· {c.locationName}{/if}
								{#if c.instructorName}· with {c.instructorName}{/if}
								· {formatDate(c.course.startsOn)}–{formatDate(c.course.endsOn)}
								{#if c.course.capacity !== null}· {c.enrolled}/{c.course.capacity} enrolled{/if}
							</p>
							{#if c.course.description}
								<p class="mt-0.5 truncate text-xs text-muted-foreground">{c.course.description}</p>
							{/if}
							{#if c.mine && c.mySessions.length}
								<details class="mt-1.5">
									<summary
										class="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground"
									>
										My sessions ({c.mySessions.filter((s) => s.status !== 'cancelled').length}
										upcoming)
									</summary>
									<div class="mt-1.5 space-y-1">
										{#each c.mySessions as s (s.bookingId)}
											<div class="flex items-center gap-2 text-xs">
												<span class="min-w-28 text-muted-foreground"
													>{localDate(s.startsAt, tz)} {localTime(s.startsAt, tz)}</span
												>
												{#if s.status === 'booked'}
													<Badge variant="secondary">Booked</Badge>
													<Button
														variant="ghost"
														size="xs"
														disabled={cBusy === s.bookingId}
														onclick={() => dropSess(s.bookingId)}>Can't make it</Button
													>
												{:else if s.status === 'waitlisted'}
													<Badge variant="outline">Waitlisted</Badge>
													<Button
														variant="ghost"
														size="xs"
														disabled={cBusy === s.bookingId}
														onclick={() => dropSess(s.bookingId)}>Drop</Button
													>
												{:else}
													<Badge variant="outline" class="text-muted-foreground">Dropped</Badge>
													<Button
														variant="ghost"
														size="xs"
														disabled={cBusy === s.bookingId}
														onclick={() => rebookSess(s.bookingId)}>Re-book</Button
													>
												{/if}
											</div>
										{/each}
									</div>
								</details>
							{/if}
						</div>
						{#if c.mine}
							<Button
								variant="ghost"
								size="sm"
								disabled={cBusy === c.course.id}
								onclick={() => quitCourse(c.course.id)}>Leave</Button
							>
						{:else if !c.full}
							<Button
								size="sm"
								disabled={cBusy === c.course.id}
								onclick={() => joinCourse(c.course.id)}
							>
								{c.course.priceCents
									? `Enroll — ${formatMoney(c.course.priceCents, currency)}${c.course.installments > 1 ? ` (${c.course.installments}×${formatMoney(Math.ceil(c.course.priceCents / c.course.installments), currency)}/mo)` : ''}`
									: 'Enroll'}
							</Button>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if portalChallenges.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base"><Trophy /> Challenges</Card.Title>
				<Card.Description>Hit the check-in goal before the window ends.</Card.Description>
			</Card.Header>
			<Card.Content class="divide-y px-6 pb-4">
				{#each portalChallenges as c (c.challenge.id)}
					<div class="py-3">
						<div class="flex items-center gap-3">
							<div class="min-w-0 flex-1">
								<div class="flex items-center gap-2">
									<span class="truncate font-medium">{c.challenge.name}</span>
									{#if c.state === 'upcoming'}
										<Badge variant="secondary">Starts {formatDate(c.challenge.startDate)}</Badge>
									{:else if c.mine && c.mine.count >= c.challenge.goal}
										<Badge>Finished</Badge>
									{/if}
								</div>
								<p class="text-sm text-muted-foreground">
									{formatDate(c.challenge.startDate)} → {formatDate(c.challenge.endDate)} ·
									{c.challenge.goal} check-ins · {c.joined}
									in{c.challenge.prize ? ` · win ${c.challenge.prize}` : ''}
								</p>
								{#if c.challenge.description}
									<p class="mt-0.5 truncate text-xs text-muted-foreground">
										{c.challenge.description}
									</p>
								{/if}
							</div>
							{#if c.mine}
								<Button
									variant="ghost"
									size="sm"
									disabled={chalBusy === c.challenge.id}
									onclick={() => leaveChal(c.challenge.id)}>Leave</Button
								>
							{:else}
								<Button
									size="sm"
									disabled={chalBusy === c.challenge.id}
									onclick={() => joinChal(c.challenge.id)}>Join</Button
								>
							{/if}
						</div>
						{#if c.mine}
							<div class="mt-2 flex items-center gap-3">
								<Progress
									value={Math.min(c.mine.count, c.challenge.goal)}
									max={c.challenge.goal}
									class="flex-1"
								/>
								<span class="text-sm text-muted-foreground tabular-nums"
									>{c.mine.count}/{c.challenge.goal}</span
								>
							</div>
						{/if}
						{#if c.leaders.length}
							<p class="mt-1.5 truncate text-xs text-muted-foreground">
								{c.leaders.map((l, i) => `${i + 1}. ${l.name} (${l.count})`).join(' · ')}
							</p>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if news.length}
		<Card.Root class="md:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">How are we doing?</Card.Title>
			</Card.Header>
			<Card.Content>
				{#if npsDue === null}
					<p class="text-sm text-muted-foreground">Loading…</p>
				{:else if !npsDue}
					<p class="text-sm text-muted-foreground">
						Thanks for the feedback — we'll ask again soon.
					</p>
				{:else if npsSent}
					<p class="text-sm text-muted-foreground">Thanks — noted!</p>
				{:else}
					<p class="text-sm text-muted-foreground">
						How likely are you to recommend us to a friend?
					</p>
					<div class="mt-2 flex flex-wrap gap-1">
						{#each [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as n (n)}
							<button
								type="button"
								class="size-8 rounded-md border text-sm transition-colors {npsScore === n
									? 'border-primary bg-primary text-primary-foreground'
									: 'text-muted-foreground hover:border-primary'}"
								onclick={() => (npsScore = n)}>{n}</button
							>
						{/each}
					</div>
					{#if npsScore !== null}
						<Input
							class="mt-3"
							placeholder="Anything we could do better? (optional)"
							bind:value={npsComment}
						/>
						<Button class="mt-2" size="sm" onclick={sendNps} disabled={npsPending}
							>{npsPending ? 'Sending…' : 'Send feedback'}</Button
						>
					{/if}
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class="sm:col-span-2">
			<Card.Header class="pb-2">
				<Card.Title class="text-base">News</Card.Title>
				<Card.Description>Announcements from your gym</Card.Description>
			</Card.Header>
			<Card.Content class="divide-y px-6">
				{#each news as n (n.sentAt)}
					<div class="py-3 first:pt-0 last:pb-0">
						<div class="flex items-baseline justify-between gap-2">
							<p class="text-sm font-medium">{n.subject}</p>
							<span class="shrink-0 text-xs text-muted-foreground"
								>{formatDate(localDate(n.sentAt, d.settings?.timezone ?? 'UTC'))}</span
							>
						</div>
						<p class="mt-1 line-clamp-3 text-sm whitespace-pre-wrap text-muted-foreground">
							{n.message}
						</p>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if d.orgSlug}
		<Card.Root class="sm:col-span-2">
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Refer a friend</Card.Title>
				<Card.Description>
					Share your link — anyone who joins from it counts toward you
					{#if d.referralCount}
						({d.referralCount} joined so far){/if}.
					{#if d.settings?.referralCredits}
						Earn {d.settings.referralCredits} class credit{d.settings.referralCredits === 1
							? ''
							: 's'} for each one that pays.{/if}
				</Card.Description>
			</Card.Header>
			<Card.Content class="flex items-center gap-2 px-6">
				<code class="flex-1 truncate rounded-md border bg-muted/40 px-3 py-2 text-xs"
					>{refLink}</code
				>
				<Button size="sm" variant="outline" onclick={copyRefLink}><Copy /> Copy</Button>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if shopItems.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header class="pb-2">
				<Card.Title class="flex items-center gap-2 text-base"
					><ShoppingBag class="size-4" /> Shop</Card.Title
				>
				<Card.Description>Buy now, pay at the desk — pick up on your next visit</Card.Description>
			</Card.Header>
			<Card.Content class="px-6">
				<div class="grid gap-2 sm:grid-cols-2">
					{#each shopItems as item (item.id)}
						<div class="flex items-center gap-3 rounded-lg border p-3">
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">{item.name}</p>
								<p class="text-sm text-muted-foreground">{formatMoney(item.price, currency)}</p>
							</div>
							{#if item.stock !== null && item.stock <= 0}
								<Badge variant="secondary">Sold out</Badge>
							{:else}
								<Button
									size="sm"
									variant="outline"
									disabled={shopBusy === item.id}
									onclick={() => buyItem(item.id)}>Buy</Button
								>
							{/if}
						</div>
					{/each}
				</div>
			</Card.Content>
		</Card.Root>
	{/if}

	{#if pendingSigns.length}
		<Card.Root class="border-amber-500/50 sm:col-span-2">
			<Card.Header>
				<Card.Title class="text-base">Documents to sign</Card.Title>
				<Card.Description>Your gym sent these for your signature</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-2 px-6">
				{#each pendingSigns as r (r.id)}
					<div class="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
						<span class="min-w-0 truncate font-medium">{r.title}</span>
						<Button
							size="sm"
							onclick={() => {
								signFor = r;
								signName = d.member.name;
							}}>Review & sign</Button
						>
					</div>
				{/each}
				{#each signRequests.filter((r) => r.status === 'signed').slice(0, 3) as r (r.id)}
					<p class="text-xs text-muted-foreground">
						Signed: {r.title} — {r.signedName}
					</p>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if movementVideos.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header class="pb-2">
				<Card.Title class="text-base">Movement library</Card.Title>
				<Card.Description>Coaching videos for your classes</Card.Description>
			</Card.Header>
			<Card.Content class="px-6">
				{#each Object.entries(Object.groupBy(movementVideos, (v) => v.className)) as [cname, vids] (cname)}
					<p class="mt-2 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
						{cname}
					</p>
					<ul class="space-y-1 text-sm">
						{#each vids as v (v.video.id)}
							<li>
								<a
									href={v.video.url}
									target="_blank"
									rel="noreferrer"
									class="text-primary hover:underline">{v.video.title}</a
								>
							</li>
						{/each}
					</ul>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root class="sm:col-span-2">
		<Card.Header class="pb-2">
			<Card.Title class="flex items-center gap-2 text-base"
				><Trophy class="size-4" /> Personal records</Card.Title
			>
		</Card.Header>
		<Card.Content class="grid gap-4 px-6 sm:grid-cols-2">
			<div>
				<form class="flex flex-wrap gap-2" onsubmit={addPr}>
					<Input placeholder="Back squat" bind:value={prLabel} class="w-32" />
					<Input placeholder="315 lb" bind:value={prValue} class="w-24" />
					<Input type="date" bind:value={prDate} class="w-36" />
					<Button type="submit" size="sm" disabled={prBusy}>Log</Button>
				</form>
				{#if prs.length}
					<ul class="mt-3 space-y-1 text-sm">
						{#each prs as pr (pr.id)}
							<li class="flex items-center gap-2">
								<span class="min-w-0 flex-1 truncate"
									><span class="font-medium">{pr.label}</span> — {pr.value}</span
								>
								<span class="shrink-0 text-xs text-muted-foreground">{pr.recordedOn}</span>
								<button
									class="shrink-0 text-muted-foreground hover:text-destructive"
									onclick={() => delPr(pr.id)}><Trash2 class="size-3.5" /></button
								>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="mt-3 text-sm text-muted-foreground">
						Log your first PR — lifts, benchmarks, anything.
					</p>
				{/if}
			</div>
			<div>
				<p class="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
					Gym leaderboard
				</p>
				{#if prBoard.length}
					<ul class="space-y-1 text-sm">
						{#each prBoard.slice(0, 10) as e (e.pr.id)}
							<li class="flex items-center gap-2">
								<span class="min-w-0 flex-1 truncate"
									><span class="font-medium">{e.memberName}</span> · {e.pr.label} — {e.pr
										.value}</span
								>
								<span class="shrink-0 text-xs text-muted-foreground">{e.pr.recordedOn}</span>
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-sm text-muted-foreground">No PRs logged yet — be first.</p>
				{/if}
			</div>
		</Card.Content>
	</Card.Root>

	{#if portalAi.configured}
		<Card.Root class="sm:col-span-2">
			<Card.Header class="pb-2">
				<Card.Title class="flex items-center gap-2 text-base"
					><Sparkles class="size-4" /> Workout plan</Card.Title
				>
				<Card.Description>An AI-generated weekly plan built around your goal</Card.Description>
			</Card.Header>
			<Card.Content class="px-6">
				{#if wpResult}
					<p class="text-sm font-medium">{wpResult.title}</p>
					<p class="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{wpResult.plan}</p>
					<Button size="sm" variant="outline" class="mt-3" onclick={() => (wpOpen = true)}
						><Sparkles /> New plan</Button
					>
				{:else}
					<Button size="sm" variant="outline" onclick={() => (wpOpen = true)}
						><Sparkles /> Generate my plan</Button
					>
				{/if}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if obDoneCount < obItems.length}
		<Card.Root class="sm:col-span-2">
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base"
					><Sparkles class="size-4" /> Getting started</Card.Title
				>
				<Card.Description
					>{obDoneCount} of {obItems.length} done — finish setting up your account</Card.Description
				>
			</Card.Header>
			<Card.Content class="space-y-1 px-6">
				<Progress max={obItems.length} value={obDoneCount} class="mb-3" />
				{#each obItems as item (item.label)}
					<div class="flex items-center gap-3 pt-1">
						<span
							class="flex size-5 shrink-0 items-center justify-center rounded-full border {item.done
								? 'border-primary bg-primary text-primary-foreground'
								: 'border-muted-foreground/30'}"
						>
							{#if item.done}<Check class="size-3" />{/if}
						</span>
						<span class="flex-1 text-sm {item.done ? 'text-muted-foreground line-through' : ''}"
							>{item.label}</span
						>
						{#if !item.done && item.action}
							<Button size="xs" variant="outline" onclick={item.fn}>{item.action}</Button>
						{/if}
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	{#if d.waiverRequired && (!d.signedWaiver || d.waiverStale)}
		<Card.Root class="sm:col-span-2" id="portal-waiver">
			<Card.Header>
				<Card.Title class="text-base"
					>{d.waiverStale ? 'Our waiver changed — please re-sign' : 'Sign your waiver'}</Card.Title
				>
				<Card.Description>Your gym requires this before your next visit.</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3 px-6">
				<p
					class="max-h-40 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-xs whitespace-pre-wrap text-muted-foreground"
				>
					{d.settings?.waiver}
				</p>
				<Button onclick={sign} disabled={signingWaiver}
					>{signingWaiver ? 'Signing…' : 'I agree — sign waiver'}</Button
				>
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><CreditCard /> Balance</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#if d.balance < 0}
				<p class="text-3xl font-semibold text-green-600 tabular-nums dark:text-green-400">
					{formatMoney(-d.balance, currency)} credit
				</p>
			{:else}
				<p class="text-3xl font-semibold tabular-nums">{formatMoney(d.balance, currency)}</p>
			{/if}
			{#if d.openCharges.length}
				<ul class="space-y-1 text-sm">
					{#each d.openCharges as c (c.charge.id)}
						<li class="flex justify-between gap-2">
							<span class="truncate text-muted-foreground"
								>{c.charge.description ?? c.charge.kind}</span
							>
							<span class="tabular-nums">{formatMoney(c.charge.amount - c.paid, currency)}</span>
						</li>
					{/each}
				</ul>
			{/if}
			{#if d.addOns.some((a) => a.active)}
				<div>
					<p class="mb-1 text-xs font-medium text-muted-foreground uppercase">Add-ons</p>
					<ul class="space-y-1 text-sm">
						{#each d.addOns as a (a.id)}
							{#if a.active}
								<li class="flex items-center justify-between gap-2">
									<span class="truncate text-muted-foreground"
										>{a.description} · next {a.nextDue}</span
									>
									<span class="flex shrink-0 items-center gap-2">
										<span class="tabular-nums">{formatMoney(a.amount, currency)}/{a.interval}</span>
										{#if a.removalRequestedAt}
											<span class="text-xs text-muted-foreground">removal requested</span>
										{:else}
											<button
												class="text-xs text-muted-foreground underline decoration-dotted underline-offset-2 hover:text-foreground"
												onclick={() => askRemoveAddon(a.id)}>stop</button
											>
										{/if}
									</span>
								</li>
							{/if}
						{/each}
					</ul>
				</div>
			{/if}
			<form
				class="flex items-center gap-2"
				onsubmit={(e) => {
					e.preventDefault();
					redeemCard();
				}}
			>
				<Input
					bind:value={gcCode}
					placeholder="Gift card code"
					class="h-8 flex-1 font-mono text-xs"
				/>
				<Button size="sm" variant="outline" type="submit" disabled={gcBusy || !gcCode.trim()}>
					{gcBusy ? 'Redeeming…' : 'Redeem'}
				</Button>
			</form>
			{#if d.payments.length}
				<div>
					<p class="mb-1 text-xs font-medium text-muted-foreground uppercase">Recent payments</p>
					<ul class="space-y-1 text-sm">
						{#each d.payments as p (p.payment.id)}
							<li class="flex justify-between gap-2">
								<span class="truncate text-muted-foreground">
									{p.chargeDescription ?? p.chargeKind ?? 'Payment'} · {localDate(
										p.payment.paidAt,
										tz
									)}
								</span>
								<span class="tabular-nums">{formatMoney(p.payment.amount, currency)}</span>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</Card.Content>
		{#if d.balance > 0 && providers.length}
			<Card.Footer class="flex flex-col gap-2">
				{#each providers as p (p.id)}
					<Button class="w-full" disabled={paying} onclick={() => pay(p.id)}>
						{paying ? 'Starting…' : p.payLabel}
					</Button>
				{/each}
			</Card.Footer>
		{/if}
	</Card.Root>

	{#if docs.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base"><FileText /> Documents</Card.Title>
			</Card.Header>
			<Card.Content class="px-4">
				{#each docs as doc (doc.id)}
					<a
						href="/api/portal/documents/{doc.id}?m={memberId}"
						target="_blank"
						class="flex items-center gap-2 py-1.5 text-sm hover:underline"
					>
						<FileText class="size-4 shrink-0 text-muted-foreground" />
						<span class="truncate">{doc.name}</span>
					</a>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><Flame /> Attendance</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3">
			<div class="grid grid-cols-2 gap-3">
				<div>
					<p class="text-3xl font-semibold tabular-nums">{d.attendance.visitsThisMonth}</p>
					<p class="text-xs text-muted-foreground">visits this month</p>
				</div>
				<div>
					<p class="text-3xl font-semibold tabular-nums">{d.attendance.weekStreak}</p>
					<p class="text-xs text-muted-foreground">
						week streak{d.attendance.longestStreak > d.attendance.weekStreak
							? ` · best ${d.attendance.longestStreak}`
							: ''}
					</p>
				</div>
			</div>
			{#if d.attendance.nextMilestone}
				<p class="text-xs text-muted-foreground">
					{d.attendance.nextMilestone - d.attendance.totalVisits} visits to your
					{d.attendance.nextMilestone}-visit milestone
				</p>
			{/if}
			{#if d.member.goalVisitsPerMonth}
				{@const goalPct = Math.min(
					100,
					Math.round((d.attendance.visitsThisMonth / d.member.goalVisitsPerMonth) * 100)
				)}
				{@const dayOfMonth = new Date().getDate()}
				{@const daysInMonth = new Date(
					new Date().getFullYear(),
					new Date().getMonth() + 1,
					0
				).getDate()}
				{@const expected = (d.member.goalVisitsPerMonth * dayOfMonth) / daysInMonth}
				{@const pace = d.attendance.visitsThisMonth - expected}
				<div class="space-y-1">
					<div class="flex items-center justify-between text-xs">
						<span class="text-muted-foreground"
							>Goal: {d.member.goalVisitsPerMonth} visits this month</span
						>
						<button
							class="text-muted-foreground underline-offset-2 hover:underline"
							onclick={editGoal}>{goalPct >= 100 ? 'Done 🎉' : `${goalPct}%`}</button
						>
					</div>
					<Progress max={d.member.goalVisitsPerMonth} value={d.attendance.visitsThisMonth} />
					{#if goalPct < 100 && dayOfMonth > 3}
						<p
							class="text-xs {pace >= -0.5
								? 'text-emerald-600 dark:text-emerald-400'
								: 'text-amber-600 dark:text-amber-400'}"
						>
							{pace >= -0.5
								? 'On track'
								: `${Math.ceil(-pace)} visit${Math.ceil(-pace) === 1 ? '' : 's'} behind pace`}
						</p>
					{/if}
				</div>
			{:else}
				<button
					class="text-xs text-muted-foreground underline-offset-2 hover:underline"
					onclick={editGoal}>Set a monthly visit goal</button
				>
			{/if}
			<p class="text-xs text-muted-foreground">
				{d.attendance.totalVisits} visits in the last 6 months
			</p>
			{#if d.attendance.recent.length}
				<ul class="space-y-1.5 border-t pt-3">
					{#each d.attendance.recent as v (v.checkedAt)}
						<li class="flex items-baseline justify-between gap-2 text-sm">
							<span class="truncate">{v.locationName ?? 'Visit'}</span>
							<span class="shrink-0 text-xs text-muted-foreground">
								{localDate(v.checkedAt, tz)} · {localTime(v.checkedAt, tz)}
							</span>
						</li>
					{/each}
				</ul>
			{/if}
		</Card.Content>
	</Card.Root>

	{#if myWorkouts.length}
		<Card.Root>
			<Card.Header>
				<Card.Title class="flex items-center gap-2 text-base"><Dumbbell /> Your workouts</Card.Title
				>
				<Card.Description>From your coach</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-3">
				{#each myWorkouts as w (w.id)}
					<div class="rounded-md border p-3 text-sm">
						<p class="font-medium">{w.title}</p>
						<p class="mt-1 whitespace-pre-wrap text-muted-foreground">{w.body}</p>
					</div>
				{/each}
			</Card.Content>
		</Card.Root>
	{/if}

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Personal training</Card.Title>
			<Card.Description>Request a 1:1 session — the gym confirms your slot</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-3">
			{#each myPt as r (r.request.id)}
				<div class="flex items-center justify-between gap-2 text-sm">
					<span>
						{localDate(r.request.preferredAt, tz)} at {localTime(r.request.preferredAt, tz)}
						{#if r.instructorName}
							· {r.instructorName}{/if}
					</span>
					<span
						class="text-xs {r.request.status === 'approved'
							? 'text-emerald-600 dark:text-emerald-400'
							: r.request.status === 'declined'
								? 'text-muted-foreground line-through'
								: 'text-amber-600 dark:text-amber-400'}">{r.request.status}</span
					>
				</div>
			{/each}
			<div class="flex flex-wrap items-center gap-2 border-t pt-3">
				<NativeSelect bind:value={ptCoach} size="sm" class="min-w-36">
					<option value="">Any coach</option>
					{#each ptCoaches as c (c.id)}
						<option value={c.id}>{c.name}</option>
					{/each}
				</NativeSelect>
				<Input type="datetime-local" class="h-8 w-auto" bind:value={ptAt} />
				<Input
					placeholder="What do you want to work on?"
					class="h-8 min-w-44 flex-1"
					bind:value={ptNote}
				/>
				<Button size="sm" disabled={ptBusy} onclick={sendPtRequest}>Request</Button>
			</div>
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><TrendingUp /> Progress</Card.Title>
		</Card.Header>
		<Card.Content class="space-y-3">
			<form class="flex flex-wrap items-center gap-2" onsubmit={logStat}>
				<NativeSelect bind:value={msKind} size="sm">
					{#each Object.entries(KIND_LABELS) as [k, label] (k)}
						<option value={k}>{label}</option>
					{/each}
				</NativeSelect>
				<Input
					type="number"
					step="0.1"
					min="0"
					required
					bind:value={msValue}
					placeholder="Value"
					class="h-8 w-24"
				/>
				<NativeSelect bind:value={msUnit} size="sm">
					{#each UNITS as u (u)}<option value={u}>{u}</option>{/each}
				</NativeSelect>
				<Input type="date" bind:value={msDate} class="h-7" aria-label="Date" />
				<Button size="sm" class="h-8" type="submit" disabled={msPending}>Log</Button>
			</form>
			{#if measurements.length}
				<ul class="space-y-1.5 border-t pt-3">
					{#each measurements as e (e.id)}
						{@const delta = statDelta(e)}
						<li class="group flex items-baseline gap-2 text-sm">
							<span class="w-16 shrink-0 text-xs text-muted-foreground"
								>{KIND_LABELS[e.kind as keyof typeof KIND_LABELS] ?? e.kind}</span
							>
							<span class="font-medium tabular-nums">{e.value} {e.unit}</span>
							{#if delta !== null}
								<span
									class="text-xs tabular-nums {delta > 0
										? 'text-amber-600'
										: delta < 0
											? 'text-green-600'
											: 'text-muted-foreground'}"
									>{delta > 0 ? '+' : ''}{Math.round(delta * 10) / 10}</span
								>
							{/if}
							<span class="ml-auto shrink-0 text-xs text-muted-foreground">{e.recordedAt}</span>
							<button
								class="shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
								onclick={() => removeStat(e.id)}
								aria-label="Delete entry"
							>
								<Trash2 class="size-3.5" />
							</button>
						</li>
					{/each}
				</ul>
			{:else}
				<p class="text-xs text-muted-foreground">
					Log your first measurement — weight, body fat, waist.
				</p>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"><CalendarDays /> Upcoming</Card.Title>
		</Card.Header>
		<Card.Content class="px-4">
			{#each d.upcoming as u (u.booking.id)}
				<div class="flex items-center justify-between py-2 text-sm">
					<div class="min-w-0">
						<p class="truncate font-medium">{u.className}</p>
						<p class="text-xs text-muted-foreground">
							{localDate(u.startsAt, tz)}
							{localTime(u.startsAt, tz)}
						</p>
						{#if u.workout}
							<p class="mt-0.5 text-xs whitespace-pre-line text-muted-foreground">
								{u.workout}
							</p>
							<Whiteboard entries={d.whiteboard[u.booking.sessionId] ?? []} {memberId} />
						{/if}
					</div>
					<span class="flex items-center gap-1.5">
						{#if u.booking.guestCount}
							<Badge variant="outline"
								>+{u.booking.guestCount} guest{u.booking.guestCount > 1 ? 's' : ''}</Badge
							>
						{/if}
						{#if u.waitlistPos}<span class="text-xs text-muted-foreground">#{u.waitlistPos}</span
							>{/if}
						<StatusBadge status={u.booking.status} />
					</span>
				</div>
			{:else}
				<p class="py-2 text-sm text-muted-foreground">Nothing booked — grab a spot below.</p>
			{/each}
			{#if d.upcoming.length}
				<a
					class="block pb-2 text-xs text-muted-foreground underline underline-offset-2"
					href="/portal/feed.ics?m={memberId}&t={d.calendarToken}"
					>Sync bookings to your calendar app</a
				>
			{/if}
		</Card.Content>
	</Card.Root>

	<Card.Root>
		<Card.Header>
			<Card.Title class="text-base">Class history</Card.Title>
		</Card.Header>
		<Card.Content class="px-4">
			{#each d.history as h (h.booking.id)}
				<div class="flex items-center justify-between py-2 text-sm">
					<div class="min-w-0">
						<p class="truncate font-medium">{h.className}</p>
						<p class="text-xs text-muted-foreground">
							{localDate(h.startsAt, tz)}{#if h.locationName}
								· {h.locationName}{/if}
						</p>
						{#if h.workout}
							<p class="mt-0.5 text-xs whitespace-pre-line text-muted-foreground">
								{h.workout}
							</p>
							<Whiteboard entries={d.whiteboard[h.sessionId] ?? []} {memberId} />
						{/if}
					</div>
					<div class="flex shrink-0 items-center gap-2">
						{#if h.booking.status === 'attended' && h.workout}
							<Button
								size="sm"
								variant="ghost"
								title="Log your score"
								onclick={() => openResult(h)}
							>
								{#if d.results[h.sessionId]}
									{d.results[h.sessionId].score}{#if d.results[h.sessionId].asRx}
										Rx{/if}
								{:else}
									Log score
								{/if}
							</Button>
						{/if}
						{#if h.booking.status === 'attended'}
							{#if d.feedback[h.sessionId]}
								<Button
									size="sm"
									variant="ghost"
									title="Update your rating"
									onclick={() => openRate(h)}
									><Star class="size-3.5 fill-amber-400 text-amber-400" />{d.feedback[h.sessionId]
										.rating}</Button
								>
							{:else}
								<Button size="sm" variant="ghost" onclick={() => openRate(h)}>Rate</Button>
							{/if}
						{/if}
						{#if nextOfType(h.classTypeId)}
							<Button
								size="sm"
								variant="ghost"
								title={`Book the next ${h.className}`}
								disabled={busy === `rebook:${h.classTypeId}`}
								onclick={() => rebook(h.classTypeId)}>Again</Button
							>
						{/if}
						<StatusBadge status={h.booking.status} />
					</div>
				</div>
			{:else}
				<p class="py-2 text-sm text-muted-foreground">No classes yet.</p>
			{/each}
		</Card.Content>
	</Card.Root>
</div>

<Card.Root id="portal-book">
	<Card.Header>
		<Card.Title class="text-base">Book a class</Card.Title>
		<Card.Description
			>The next two weeks at {data.options.find((o) => o.memberId === memberId)
				?.gymName}.</Card.Description
		>
	</Card.Header>
	<Card.Content class="px-4">
		<Table.Root>
			<Table.Header>
				<Table.Row>
					<Table.Head>Class</Table.Head>
					<Table.Head class="hidden sm:table-cell">When</Table.Head>
					<Table.Head>Spots</Table.Head>
					<Table.Head class="text-right"></Table.Head>
				</Table.Row>
			</Table.Header>
			<Table.Body>
				{#each bookable as b (b.session.id)}
					<Table.Row>
						<Table.Cell>
							<span class="mr-2 inline-block size-2 rounded-full" style:background={b.color}></span>
							{b.className}
							{#if b.locationName}<span class="text-xs text-muted-foreground"
									>· {b.locationName}</span
								>{/if}
						</Table.Cell>
						<Table.Cell class="hidden text-muted-foreground sm:table-cell">
							{localDate(b.session.startsAt, tz)}
							{localTime(b.session.startsAt, tz)}
						</Table.Cell>
						<Table.Cell class="text-muted-foreground">
							{b.booked}/{b.session.capacity}
						</Table.Cell>
						<Table.Cell class="text-right">
							{#if b.myStatus && b.myStatus !== 'cancelled'}
								<span class="mr-2"><StatusBadge status={b.myStatus} /></span>
								<Button
									size="sm"
									variant="ghost"
									title="Move to a different session"
									disabled={busy === b.session.id}
									onclick={() => {
										moveFrom = b;
										moveOpen = true;
									}}>Move</Button
								>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy === b.session.id}
									onclick={() => cancel(myBookingId(b)!, b.session.id)}>Cancel</Button
								>
							{:else if !b.memberBookable}
								<span class="text-xs whitespace-nowrap text-muted-foreground">Book at the desk</span
								>
							{:else if !hasPlan && (!b.dropInPrice || b.dropInPrice <= 0)}
								<span class="text-xs whitespace-nowrap text-muted-foreground">Needs a plan</span>
							{:else if !hasPlan && b.booked >= b.session.capacity}
								<span class="text-xs whitespace-nowrap text-muted-foreground">Full</span>
							{:else}
								<div class="flex items-center justify-end gap-1">
									{#if hasPlan}
										<Button
											size="sm"
											variant="ghost"
											title={`Book every upcoming ${b.className}`}
											disabled={busy === b.session.id || busy === `series:${b.session.classTypeId}`}
											onclick={() => bookSeriesAll(b.session.classTypeId, b.className)}
											>Series</Button
										>
									{/if}
									<NativeSelect
										size="sm"
										title="Bring guests — uses guest passes first, then drop-in price"
										bind:value={guestPick[b.session.id]}
									>
										<option value="0">Just me</option>
										{#each [1, 2, 3] as n (n)}
											<option value={String(n)}>+{n} guest{n > 1 ? 's' : ''}</option>
										{/each}
									</NativeSelect>
									<Button
										size="sm"
										variant="outline"
										disabled={busy === b.session.id}
										onclick={() => book(b.session.id)}
									>
										{!hasPlan && b.dropInPrice
											? d.dropInFree
												? 'Book — first class free'
												: `Book — ${formatMoney(b.dropInPrice, currency)}`
											: b.booked >= b.session.capacity
												? 'Join waitlist'
												: 'Book'}
									</Button>
								</div>
							{/if}
						</Table.Cell>
					</Table.Row>
				{:else}
					<Table.Row
						><Table.Cell colspan={4} class="text-muted-foreground">No classes scheduled.</Table.Cell
						></Table.Row
					>
				{/each}
			</Table.Body>
		</Table.Root>
	</Card.Content>
</Card.Root>

<Dialog.Root bind:open={depOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Add a family member</Dialog.Title>
			<Dialog.Description>
				They'll show up in your member switcher — you can book classes and sign waivers for them,
				and their charges bill under your account.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitDependent}>
			<div class="space-y-1.5">
				<label class="text-sm font-medium" for="dep-name">Name</label>
				<Input id="dep-name" required bind:value={depName} placeholder="e.g. Sam Rivera" />
			</div>
			<div class="space-y-1.5">
				<label class="text-sm font-medium" for="dep-bday">
					Birthday <span class="font-normal text-muted-foreground">(optional)</span>
				</label>
				<Input id="dep-bday" type="date" bind:value={depBirthday} />
			</div>
			<Dialog.Footer>
				<Button type="submit" disabled={depPending}
					>{depPending ? 'Adding…' : 'Add family member'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={wpOpen}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Generate a workout plan</Dialog.Title>
			<Dialog.Description>
				Answer a couple of questions — the AI writes a one-week plan for you.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={submitWorkoutPlan}>
			<Field.Field>
				<Field.Label for="wp-goal">Your goal</Field.Label>
				<Input
					id="wp-goal"
					required
					bind:value={wpGoal}
					placeholder="e.g. Build strength, lose weight, get fitter"
				/>
			</Field.Field>
			<div class="grid grid-cols-2 gap-4">
				<Field.Field>
					<Field.Label for="wp-days">Days / week</Field.Label>
					<Input id="wp-days" type="number" min={1} max={7} bind:value={wpDays} />
				</Field.Field>
				<Field.Field>
					<Field.Label for="wp-min">Minutes / session</Field.Label>
					<Input id="wp-min" type="number" min={10} max={240} bind:value={wpMinutes} />
				</Field.Field>
			</div>
			<Field.Field>
				<Field.Label for="wp-notes">
					Anything to work around? <span class="font-normal text-muted-foreground">(optional)</span>
				</Field.Label>
				<Textarea
					id="wp-notes"
					bind:value={wpNotes}
					rows={2}
					placeholder="e.g. bad knees, no barbell"
				/>
			</Field.Field>
			<Dialog.Footer>
				<Button type="submit" disabled={wpPending}
					>{wpPending ? 'Generating…' : 'Generate plan'}</Button
				>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={moveOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Move your spot</Dialog.Title>
			<Dialog.Description>
				{#if moveFrom}
					{moveFrom.className} · {localDate(moveFrom.session.startsAt, tz)}
					{localTime(moveFrom.session.startsAt, tz)} → pick a new session. Your old spot frees the moment
					the new one is yours.
				{/if}
			</Dialog.Description>
		</Dialog.Header>
		{#if moveTargets.length}
			<div class="max-h-80 divide-y overflow-y-auto rounded-lg border">
				{#each moveTargets as c (c.session.id)}
					<div class="flex items-center justify-between gap-2 px-3 py-2 text-sm">
						<div class="min-w-0">
							<span class="mr-1.5 inline-block size-2 rounded-full" style:background={c.color}
							></span>
							<span class="font-medium">{c.className}</span>
							<p class="text-xs text-muted-foreground">
								{localDate(c.session.startsAt, tz)}
								{localTime(c.session.startsAt, tz)} · {c.session.capacity - c.booked} spot{c.session
									.capacity -
									c.booked ===
								1
									? ''
									: 's'} left{#if c.locationName}
									· {c.locationName}{/if}
							</p>
						</div>
						<Button
							size="sm"
							variant="outline"
							disabled={busy === `move:${c.session.id}`}
							onclick={() => moveTo(c.session.id)}>Move here</Button
						>
					</div>
				{/each}
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">
				No open sessions to move into — full classes only take waitlist joins.
			</p>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!rateFor} onOpenChange={(o) => !o && (rateFor = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Rate {rateFor?.className}</Dialog.Title>
			<Dialog.Description>How was the class?</Dialog.Description>
		</Dialog.Header>
		<div class="flex items-center gap-1.5 py-2">
			{#each [1, 2, 3, 4, 5] as n (n)}
				<button
					type="button"
					class="rounded p-0.5 hover:scale-110"
					aria-label="{n} star{n === 1 ? '' : 's'}"
					onclick={() => (rateValue = n)}
				>
					<Star
						class="size-8 {n <= rateValue
							? 'fill-amber-400 text-amber-400'
							: 'text-muted-foreground'}"
					/>
				</button>
			{/each}
		</div>
		<Textarea placeholder="Anything to add? (optional)" maxlength={500} bind:value={rateComment} />
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (rateFor = null)}>Cancel</Button>
			<Button onclick={submitRating} disabled={rateBusy || !rateValue}>Submit</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!resultFor} onOpenChange={(o) => !o && (resultFor = null)}>
	<Dialog.Content>
		<Dialog.Header>
			<Dialog.Title>Log your score — {resultFor?.className}</Dialog.Title>
			<Dialog.Description>How did the workout go? e.g. "12:34" or "185 lb"</Dialog.Description>
		</Dialog.Header>
		<Field.Field>
			<Field.Label for="result-score">Score</Field.Label>
			<Input id="result-score" bind:value={resultScore} maxlength={120} />
		</Field.Field>
		<label class="flex items-center gap-2 text-sm">
			<Checkbox checked={resultRx} onCheckedChange={(v) => (resultRx = v === true)} />
			As prescribed (Rx)
		</label>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (resultFor = null)}>Cancel</Button>
			<Button onclick={submitResult} disabled={resultBusy || !resultScore.trim()}>
				Save score
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root open={!!signFor} onOpenChange={(o) => !o && (signFor = null)}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>{signFor?.title}</Dialog.Title>
			<Dialog.Description>Read the document, then type your name to sign.</Dialog.Description>
		</Dialog.Header>
		<p
			class="max-h-64 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm whitespace-pre-wrap text-muted-foreground"
		>
			{signFor?.body}
		</p>
		<Field.Field>
			<Field.Label for="sign-name">Sign as</Field.Label>
			<Input id="sign-name" placeholder="Your full name" bind:value={signName} />
		</Field.Field>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (signFor = null)}>Cancel</Button>
			<Button onclick={doSign} disabled={signBusy || signName.trim().length < 2}>
				{signBusy ? 'Signing…' : 'Sign document'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={giftOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Gift classes to a friend</Dialog.Title>
			<Dialog.Description>
				Move classes off your pack to another member. They need an account at your gym already.
			</Dialog.Description>
		</Dialog.Header>
		<form class="space-y-4" onsubmit={sendGift}>
			<Field.Field>
				<Field.Label for="gift-email">Their email</Field.Label>
				<Input
					id="gift-email"
					type="email"
					placeholder="friend@email.com"
					bind:value={giftEmail}
					required
				/>
			</Field.Field>
			<Field.Field>
				<Field.Label for="gift-n">Classes</Field.Label>
				<Input id="gift-n" type="number" min="1" bind:value={giftCredits} required />
			</Field.Field>
			<Button type="submit" class="w-full" disabled={giftPending}>
				{giftPending ? 'Sending…' : 'Gift classes'}
			</Button>
		</form>
	</Dialog.Content>
</Dialog.Root>
