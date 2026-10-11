<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import type { ApiPermissions } from '#lib/api-permissions.ts';
	import PageHeader from '#lib/components/app/page-header.svelte';
	import * as Card from '#lib/components/ui/card/index.js';
	import * as Tabs from '#lib/components/ui/tabs/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import * as Select from '#lib/components/ui/select/index.js';
	import * as Table from '#lib/components/ui/table/index.js';
	import * as Dialog from '#lib/components/ui/dialog/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import MoneyInput from '#lib/components/app/money-input.svelte';
	import { Textarea } from '#lib/components/ui/textarea/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Badge } from '#lib/components/ui/badge/index.js';
	import { toast } from 'svelte-sonner';
	import { authClient } from '#lib/auth-client.ts';
	import {
		getSettings,
		updateSettings,
		getLocations,
		createLocation,
		updateLocation,
		getWebhooks,
		createWebhook,
		toggleWebhook,
		deleteWebhook,
		testWebhook,
		getStaff,
		getJoinInfo,
		seedDemo,
		removeLogo
	} from '#lib/remote/workspace.remote.ts';
	import {
		getPaymentProviders,
		toggleProvider,
		connectProvider,
		refreshProvider
	} from '#lib/remote/payments.remote.ts';
	import { getApiKeys, createApiKey, deleteApiKey } from '#lib/remote/api-keys.remote.ts';
	import {
		getClosures,
		addClosure,
		removeClosure,
		freezeAllMemberships
	} from '#lib/remote/schedule.remote.ts';
	import {
		getLockers,
		addLocker,
		removeLocker,
		releaseLocker,
		getLoanables,
		addLoanable,
		removeLoanable
	} from '#lib/remote/members.remote.ts';
	import { API_RESOURCES } from '#lib/api-permissions.ts';
	import {
		getMemberFields,
		saveMemberFieldCmd,
		deleteMemberFieldCmd
	} from '#lib/remote/custom-fields.remote.ts';
	import {
		anonymizeInactiveMembers,
		getEntitlements,
		testDoorWebhook,
		getOrgDataExport
	} from '#lib/remote/ee.remote.ts';
	import { errMsg, formatDate } from '#lib/format.ts';
	import { NativeSelect } from '#lib/components/ui/native-select/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash from '@lucide/svelte/icons/trash-2';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Printer from '@lucide/svelte/icons/printer';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import Map from '@lucide/svelte/icons/map';
	import { tour } from '#lib/tour.svelte.ts';

	let settings = $state(await getSettings());
	let locations = $state(await getLocations());
	const lockers = $derived(await getLockers());
	const loanables = $derived(await getLoanables());
	let newKit = $state('');
	let newKitQty = $state<number>(1);
	async function addKitSubmit(e: SubmitEvent) {
		e.preventDefault();
		try {
			await addLoanable({ name: newKit, quantity: newKitQty || 1 });
			newKit = '';
			newKitQty = 1;
			toast.success('Item added');
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		}
	}
	let newLocker = $state('');
	async function addLockerSubmit(e: SubmitEvent) {
		e.preventDefault();
		try {
			await addLocker({ label: newLocker });
			newLocker = '';
			toast.success('Locker added');
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		}
	}
	let webhooks = $state(await getWebhooks());
	let apiKeys = $state(await getApiKeys());
	let providerList = $state(await getPaymentProviders());
	let closures = $state(await getClosures());
	const staff = await getStaff();
	const joinInfo = await getJoinInfo();
	const memberFields = $derived(await getMemberFields());
	const entitlements = $derived(await getEntitlements());

	let exportBusy = $state(false);
	async function exportOrgData() {
		exportBusy = true;
		try {
			const res = await getOrgDataExport();
			if (!res.licensed || !res.data) {
				toast.error('Data export is an Enterprise feature');
				return;
			}
			const blob = new Blob([JSON.stringify(res.data, null, 2)], {
				type: 'application/json'
			});
			const a = document.createElement('a');
			a.href = URL.createObjectURL(blob);
			a.download = `freeweight-export-${new Date().toISOString().slice(0, 10)}.json`;
			a.click();
			URL.revokeObjectURL(a.href);
		} catch (e) {
			toast.error(errMsg(e, 'Export failed'));
		}
		exportBusy = false;
	}
	let cfOpen = $state(false);
	let cfEditId = $state<string | null>(null);
	let cfName = $state('');
	let cfKind = $state<'text' | 'number' | 'date' | 'select'>('text');
	let cfOptions = $state('');
	let cfBusy = $state(false);

	function openCfField(f?: { id: string; name: string; kind: string; options: string }) {
		cfEditId = f?.id ?? null;
		cfName = f?.name ?? '';
		cfKind = (f?.kind as 'text' | 'number' | 'date' | 'select') ?? 'text';
		cfOptions = f?.options ?? '';
		cfOpen = true;
	}

	async function saveCfField() {
		cfBusy = true;
		try {
			await saveMemberFieldCmd({
				id: cfEditId ?? undefined,
				name: cfName,
				kind: cfKind,
				options: cfOptions
			});
			cfOpen = false;
			toast.success('Field saved');
		} catch (e) {
			toast.error(errMsg(e, 'Something went wrong'));
		} finally {
			cfBusy = false;
		}
	}

	let joinQr = $state('');
	$effect(() => {
		if (joinQr) return;
		void import('qrcode').then((m) =>
			m.default.toDataURL(joinInfo.url, { width: 280, margin: 1 }).then((u: string) => (joinQr = u))
		);
	});
	async function copyJoinLink(short = false) {
		const link = short ? joinInfo.url + '/schedule' : joinInfo.url;
		await navigator.clipboard.writeText(link);
		toast.success('Join link copied');
	}
	let pending = $state(false);
	let cDate = $state('');
	let cReason = $state('');
	let cPending = $state(false);

	async function submitClosure(e: SubmitEvent) {
		e.preventDefault();
		cPending = true;
		try {
			const c = await addClosure({ date: cDate, reason: cReason });
			closures = await getClosures();
			cDate = '';
			cReason = '';
			toast.success(
				c.sessionsCancelled
					? `Closed — ${c.sessionsCancelled} session${c.sessionsCancelled === 1 ? '' : 's'} cancelled`
					: 'Closure added'
			);
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		} finally {
			cPending = false;
		}
	}
	async function delClosure(id: string) {
		await removeClosure(id).catch((err) => toast.error(errMsg(err, 'Could not remove')));
		closures = await getClosures();
	}

	let fzUntil = $state('');
	let fzPending = $state(false);
	async function submitFreezeAll(e: SubmitEvent) {
		e.preventDefault();
		if (
			!confirm(
				`Pause every active plan until ${fzUntil}? They auto-resume that day and no fees are charged.`
			)
		)
			return;
		fzPending = true;
		try {
			const r = await freezeAllMemberships({ until: fzUntil });
			toast.success(`Froze ${r.frozen} active plan${r.frozen === 1 ? '' : 's'} until ${r.until}`);
		} catch (err) {
			toast.error(errMsg(err, 'Could not freeze memberships'));
		}
		fzPending = false;
	}

	// ------- general -------
	let timezone = $state(settings.timezone);
	let currency = $state(settings.currency);
	let tagline = $state(settings.tagline);
	// svelte-ignore state_referenced_locally
	let logoId = $state(settings.logoDocumentId);
	let logoBusy = $state(false);
	async function uploadLogo(e: Event) {
		const file = (e.currentTarget as HTMLInputElement).files?.[0];
		if (!file) return;
		logoBusy = true;
		try {
			const form = new FormData();
			form.set('entityType', 'org_logo');
			form.set('file', file);
			const res = await fetch('/api/documents', { method: 'POST', body: form });
			if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.message ?? res.statusText);
			const doc = await res.json();
			logoId = doc.id;
			toast.success('Logo updated');
		} catch (err) {
			toast.error(errMsg(err, 'Could not upload logo'));
		}
		logoBusy = false;
		(e.currentTarget as HTMLInputElement).value = '';
	}
	async function clearLogo() {
		logoBusy = true;
		try {
			await removeLogo();
			logoId = null;
			toast.success('Logo removed');
		} catch (err) {
			toast.error(errMsg(err, 'Could not remove logo'));
		}
		logoBusy = false;
	}
	let address = $state(settings.address);
	let phone = $state(settings.phone);
	let website = $state(settings.website);
	let waiver = $state(settings.waiver);
	let portalNotice = $state(settings.portalNotice);
	let bookingWindowDays = $state<number | null>(settings.bookingWindowDays);
	let cancelCutoffMin = $state<number | null>(settings.cancelCutoffMin);
	let bookCutoffMin = $state<number | null>(settings.bookCutoffMin);
	let waitlistCutoffMin = $state<number | null>(settings.waitlistCutoffMin);
	let maxBookingsPerDay = $state<number | null>(settings.maxBookingsPerDay);
	// svelte-ignore state_referenced_locally
	let occupancyCap = $state<number | null>(settings.occupancyCap);
	let noShowFee = $state<number | null>(settings.noShowFee);
	let lateCancelFee = $state<number | null>(settings.lateCancelFee);
	let lateCancelFreebies = $state<number | null>(settings.lateCancelFreebies);
	let dayPassPrice = $state<number | null>(settings.dayPassPrice);
	let suspendAfterDays = $state<number | null>(settings.suspendAfterDays);
	let referralCredits = $state<number | null>(settings.referralCredits);
	// svelte-ignore state_referenced_locally
	let saveOfferPct = $state<number | null>(settings.saveOfferPct);
	let freezeFee = $state<number | null>(settings.freezeFee);
	let reviewUrl = $state(settings.reviewUrl ?? '');
	let reviewAfterVisits = $state<number | null>(settings.reviewAfterVisits);
	let rewardCredits = $state<number | null>(settings.rewardCredits);
	let streakRewardCredits = $state<number | null>(settings.streakRewardCredits);
	let birthdayCompCredits = $state<number | null>(settings.birthdayCompCredits);
	let selfFreezeDays = $state<number | null>(settings.selfFreezeDays);
	let revenueTarget = $state<number | null>(settings.revenueTarget);
	let publicPage = $state(settings.publicPage);
	let staffBriefing = $state(settings.staffBriefing);
	// svelte-ignore state_referenced_locally
	let whiteLabel = $state(settings.whiteLabel);
	// svelte-ignore state_referenced_locally
	let kioskPin = $state(settings.kioskPin);
	// svelte-ignore state_referenced_locally
	let retentionDays = $state(settings.retentionDays);
	let doorWebhookUrl = $state(settings.doorWebhookUrl);
	let anonymizeMonths = $state(settings.anonymizeMonths);
	let exportWebhookUrl = $state(settings.exportWebhookUrl);
	let brandColor = $state(settings.brandColor);
	let anonBusy = $state(false);
	let doorBusy = $state(false);
	// svelte-ignore state_referenced_locally
	let firstClassFree = $state(settings.firstClassFree);
	const tzOptions = Intl.supportedValuesOf('timeZone');
	const currencyOptions = ['usd', 'eur', 'gbp', 'aud', 'cad', 'nzd', 'brl', 'inr'];
	type DayHours = { open: string; close: string; closed: boolean };
	const hourDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	let hours = $state<DayHours[]>(
		hourDays.map((_, i) => {
			const v2 = (settings.openHours ?? {})[String(i)] ?? '';
			const [open = '', close = ''] = v2.split('-');
			return { open, close, closed: v2 === '' };
		})
	);
	/** Serializes the editor back to the {weekday: 'HH:MM-HH:MM'|''} record. */
	const hoursOut = $derived(
		Object.fromEntries(
			hours.map((h, i) => [
				String(i),
				h.closed || !h.open || !h.close ? '' : `${h.open}-${h.close}`
			])
		)
	);

	async function saveSettings(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			settings = await updateSettings({
				timezone,
				currency,
				tagline,
				address,
				phone,
				website,
				waiver,
				portalNotice,
				bookingWindowDays,
				cancelCutoffMin,
				bookCutoffMin,
				waitlistCutoffMin,
				maxBookingsPerDay,
				occupancyCap,
				noShowFee,
				lateCancelFee,
				lateCancelFreebies,
				dayPassPrice,
				suspendAfterDays,
				referralCredits,
				saveOfferPct,
				freezeFee,
				reviewUrl: reviewUrl.trim() || null,
				reviewAfterVisits,
				rewardCredits,
				streakRewardCredits,
				birthdayCompCredits,
				selfFreezeDays,
				revenueTarget,
				publicPage,
				staffBriefing,
				whiteLabel,
				kioskPin,
				retentionDays,
				doorWebhookUrl,
				anonymizeMonths,
				exportWebhookUrl,
				brandColor,
				firstClassFree,
				openHours: hoursOut
			});
			toast.success('Settings saved');
		} catch (err) {
			toast.error(errMsg(err, 'Could not save'));
		}
		pending = false;
	}

	// ------- locations -------
	let locOpen = $state(false);
	let locName = $state('');
	async function addLocation(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createLocation({ name: locName });
			locations = await getLocations();
			locOpen = false;
			locName = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add'));
		}
		pending = false;
	}
	async function archiveLocation(id: string, archived: boolean) {
		try {
			await updateLocation({ id, archived });
			locations = await getLocations();
		} catch (err) {
			toast.error(errMsg(err, 'Could not update'));
		}
	}

	// ------- team -------
	let inviteEmail = $state('');
	let inviteRole = $state<'admin' | 'member'>('member');
	async function invite(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		const { error } = await authClient.organization.inviteMember({
			email: inviteEmail,
			role: inviteRole
		});
		pending = false;
		if (error) return toast.error(error.message ?? 'Could not invite');
		toast.success(`Invitation sent to ${inviteEmail}`);
		inviteEmail = '';
	}
	async function removeStaff(id: string) {
		const { error } = await authClient.organization.removeMember({ memberIdOrEmail: id });
		if (error) return toast.error(error.message ?? 'Could not remove');
		toast.success('Removed');
	}

	// ------- api keys -------
	let keyName = $state('');
	let keyPerms = $state<Record<string, boolean>>({});
	let newKey = $state<string | null>(null);
	async function createKey(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			const permissions: ApiPermissions = Object.fromEntries(
				Object.entries(keyPerms)
					.filter(([, on]) => on)
					.map(([res]) => [res, ['read', 'write']])
			);
			const { key } = await createApiKey({ name: keyName, permissions });
			newKey = key;
			keyName = '';
			keyPerms = {};
			apiKeys = await getApiKeys();
		} catch (err) {
			toast.error(errMsg(err, 'Could not create key'));
		}
		pending = false;
	}
	async function removeKey(id: string) {
		try {
			await deleteApiKey(id);
			apiKeys = await getApiKeys();
		} catch (err) {
			toast.error(errMsg(err, 'Could not delete'));
		}
	}

	// ------- webhooks -------
	let hookUrl = $state('');
	let hookEvents = $state('member.created,member.joined');
	async function addWebhook(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		try {
			await createWebhook({
				url: hookUrl,
				events: hookEvents
					.split(',')
					.map((s) => s.trim())
					.filter(Boolean)
			});
			webhooks = await getWebhooks();
			hookUrl = '';
		} catch (err) {
			toast.error(errMsg(err, 'Could not add webhook'));
		}
		pending = false;
	}

	// ------- payments -------
	async function copy(text: string) {
		await navigator.clipboard.writeText(text);
		toast.success('Copied');
	}
</script>

<PageHeader title="Settings" />

<div class="p-4 md:p-6">
	<Tabs.Root value="general">
		<Tabs.List class="mb-4 flex-wrap">
			<Tabs.Trigger value="general">General</Tabs.Trigger>
			<Tabs.Trigger value="locations">Locations</Tabs.Trigger>
			<Tabs.Trigger value="team">Team</Tabs.Trigger>
			<Tabs.Trigger value="payments">Payments</Tabs.Trigger>
			<Tabs.Trigger value="api">API</Tabs.Trigger>
			<Tabs.Trigger value="webhooks">Webhooks</Tabs.Trigger>
			<Tabs.Trigger value="demo">Demo</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="general">
			<Card.Root class="max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Workspace</Card.Title>
					<Card.Description>Timezone, currency and the public join page.</Card.Description>
				</Card.Header>
				<Card.Content>
					<form class="space-y-4" onsubmit={saveSettings}>
						<div class="grid gap-4 sm:grid-cols-2">
							<Field.Field>
								<Field.Label>Timezone</Field.Label>
								<Select.Root type="single" bind:value={timezone}>
									<Select.Trigger class="w-full">{timezone}</Select.Trigger>
									<Select.Content>
										{#each tzOptions as t (t)}
											<Select.Item value={t}>{t}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<Field.Description>Class times and billing run in this zone.</Field.Description>
							</Field.Field>
							<Field.Field>
								<Field.Label>Currency</Field.Label>
								<Select.Root type="single" bind:value={currency}>
									<Select.Trigger class="w-full">{currency.toUpperCase()}</Select.Trigger>
									<Select.Content>
										{#each currencyOptions as c (c)}
											<Select.Item value={c}>{c.toUpperCase()}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
							</Field.Field>
						</div>
						<Field.Field>
							<Field.Label for="tagline">Tagline</Field.Label>
							<Input id="tagline" bind:value={tagline} placeholder="Strength, community, sweat." />
						</Field.Field>
						<Field.Field>
							<Field.Label for="logo">Logo</Field.Label>
							<div class="flex items-center gap-3">
								{#if logoId}
									<img
										src={`/api/logo/${logoId}`}
										alt="Gym logo"
										class="h-12 w-auto rounded-md border bg-muted object-contain p-1"
									/>
									<Button variant="ghost" size="sm" disabled={logoBusy} onclick={clearLogo}
										>Remove</Button
									>
								{/if}
								<Input
									id="logo"
									type="file"
									accept="image/png,image/jpeg,image/webp,image/gif"
									disabled={logoBusy}
									onchange={uploadLogo}
								/>
							</div>
							<Field.Description>
								Shown on your public join page, the member portal and the kiosk.
							</Field.Description>
						</Field.Field>
						<Field.Field>
							<Field.Label for="addr">Address</Field.Label>
							<Input id="addr" bind:value={address} />
						</Field.Field>
						<div class="grid gap-4 sm:grid-cols-2">
							<Field.Field>
								<Field.Label for="phone">Phone</Field.Label>
								<Input id="phone" bind:value={phone} />
							</Field.Field>
							<Field.Field>
								<Field.Label for="site">Website</Field.Label>
								<Input id="site" bind:value={website} />
							</Field.Field>
						</div>
						<Field.Field>
							<Field.Label for="waiver">Liability waiver</Field.Label>
							<Textarea
								id="waiver"
								rows={5}
								bind:value={waiver}
								placeholder="Leave blank to skip waivers. When set, joiners, drop-ins and portal members must agree before visiting."
							/>
						</Field.Field>
						<Field.Field>
							<Field.Label for="pnotice">Portal notice</Field.Label>
							<Textarea
								id="pnotice"
								rows={2}
								bind:value={portalNotice}
								placeholder="Shown at the top of every member's portal — 'Closed Thanksgiving', 'Parking lot closed'. Blank hides it."
							/>
						</Field.Field>
						<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
							<div>
								<p class="font-medium">Public join page</p>
								<p class="text-xs text-muted-foreground">
									Show plans and the weekly schedule on your public join page.
								</p>
							</div>
							<Switch bind:checked={publicPage} />
						</div>
						<Button type="submit" disabled={pending}>Save</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Booking policies</Card.Title>
					<Card.Description
						>How far ahead members can book, cancel and join waitlists.</Card.Description
					>
				</Card.Header>
				<Card.Content>
					<form class="space-y-4" onsubmit={saveSettings}>
						<div class="grid gap-4 sm:grid-cols-2">
							<Field.Field>
								<Field.Label for="bwindow">Booking window (days)</Field.Label>
								<Input
									id="bwindow"
									type="number"
									min={1}
									bind:value={bookingWindowDays}
									placeholder="Any time"
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="ccutoff">Cancel cutoff (minutes)</Field.Label>
								<Input
									id="ccutoff"
									type="number"
									min={0}
									bind:value={cancelCutoffMin}
									placeholder="Any time"
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="bcutoff">Booking cutoff (minutes)</Field.Label>
								<Input
									id="bcutoff"
									type="number"
									min={0}
									bind:value={bookCutoffMin}
									placeholder="Bookable until class starts"
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="wcutoff">Waitlist cutoff (minutes)</Field.Label>
								<Input
									id="wcutoff"
									type="number"
									min={0}
									bind:value={waitlistCutoffMin}
									placeholder="Always promote"
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="daycap">Max bookings per day</Field.Label>
								<Input
									id="daycap"
									type="number"
									min={1}
									bind:value={maxBookingsPerDay}
									placeholder="Unlimited"
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="occ-cap">Occupancy cap</Field.Label>
								<Input
									id="occ-cap"
									type="number"
									min={1}
									bind:value={occupancyCap}
									placeholder="No cap"
								/>
								<Field.Description
									>Max people inside at once — the kiosk warns past this.</Field.Description
								>
							</Field.Field>
						</div>
						<Button type="submit" disabled={pending}>Save</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Fees &amp; billing</Card.Title>
					<Card.Description>No-show and late-cancel fees, day passes and dunning.</Card.Description>
				</Card.Header>
				<Card.Content>
					<form class="space-y-4" onsubmit={saveSettings}>
						<Field.Field>
							<Field.Label>No-show fee</Field.Label>
							<MoneyInput bind:value={noShowFee} />
							<Field.Description
								>Charged to the member for every class they skip without checking in.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label>Late-cancel fee</Field.Label>
							<MoneyInput bind:value={lateCancelFee} />
							<Field.Description
								>When set, members can cancel inside the cancel cutoff — for this fee. Leave empty
								to block late cancels entirely.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-late-free">Free late cancels / month</Field.Label>
							<Input
								id="s-late-free"
								type="number"
								min={0}
								bind:value={lateCancelFreebies}
								placeholder="0"
							/>
							<Field.Description
								>Each member's first N late cancels a month skip the fee — a goodwill budget, not a
								loophole.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label>Day pass price</Field.Label>
							<MoneyInput bind:value={dayPassPrice} />
							<Field.Description
								>Sells a one-day visit on your public join page. Leave empty to hide it.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-suspend">Suspend membership after days overdue</Field.Label>
							<Input
								id="s-suspend"
								type="number"
								min={1}
								bind:value={suspendAfterDays}
								placeholder="Never"
							/>
							<Field.Description
								>Members this many days behind on a charge lose class bookings until they pay up;
								billing keeps accruing meanwhile.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-refcredits">Referral reward (credits)</Field.Label>
							<Input
								id="s-refcredits"
								type="number"
								min={1}
								bind:value={referralCredits}
								placeholder="Off"
							/>
							<Field.Description
								>Class credits granted to a member the first time someone who joined through their
								referral link makes a payment. Leave empty for no reward.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label>Freeze fee</Field.Label>
							<MoneyInput bind:value={freezeFee} />
							<Field.Description
								>One-time charge posted when a membership is paused. Leave empty to freeze free.</Field.Description
							>
						</Field.Field>
						<Button type="submit" disabled={pending}>Save</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Rewards &amp; retention</Card.Title>
					<Card.Description
						>Win-back offers, milestone rewards, review nudges and member self-freeze.</Card.Description
					>
				</Card.Header>
				<Card.Content>
					<form class="space-y-4" onsubmit={saveSettings}>
						<Field.Field>
							<Field.Label for="s-save">Stay offer (% off next bill)</Field.Label>
							<Input
								id="s-save"
								type="number"
								min={1}
								max={100}
								bind:value={saveOfferPct}
								placeholder="Off"
							/>
							<Field.Description
								>Shown inside the member's cancellation form — "Stay instead, N% off your next
								bill". Applies a one-time account credit; each membership can take it once. Leave
								empty for no offer.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label>Monthly revenue target</Field.Label>
							<MoneyInput bind:value={revenueTarget} />
							<Field.Description
								>Reports shows this month's collected revenue as a progress bar against the target.
								Leave empty for no target.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-review-url">Review link</Field.Label>
							<Input
								id="s-review-url"
								type="url"
								bind:value={reviewUrl}
								placeholder="https://g.page/r/your-gym/review"
							/>
							<Field.Description
								>Google/Yelp review URL sent to loyal members — leave empty to never ask.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-review-after">Ask for a review after N visits</Field.Label>
							<Input
								id="s-review-after"
								type="number"
								min={1}
								bind:value={reviewAfterVisits}
								placeholder="Off"
							/>
							<Field.Description
								>Once a member's lifetime check-ins reach this, they get one review-request email
								(never twice).</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-reward">Milestone reward — comp classes</Field.Label>
							<Input
								id="s-reward"
								type="number"
								min={0}
								bind:value={rewardCredits}
								placeholder="Off"
							/>
							<Field.Description
								>Comp classes granted when a member hits a check-in milestone (10, 25, 50, …) —
								blank or 0 = off.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-streak-reward">Streak reward — comp classes</Field.Label>
							<Input
								id="s-streak-reward"
								type="number"
								min={0}
								bind:value={streakRewardCredits}
								placeholder="Off"
							/>
							<Field.Description
								>Comp classes granted at week-streak milestones (4, 8, 13, 26, 52) — each streak
								pays once.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-bday-comp">Birthday treat — comp classes</Field.Label>
							<Input
								id="s-bday-comp"
								type="number"
								min={0}
								bind:value={birthdayCompCredits}
								placeholder="Off"
							/>
							<Field.Description
								>Comp classes banked on each member's birthday — sent with the birthday email. Blank
								or 0 = off.</Field.Description
							>
						</Field.Field>
						<Field.Field>
							<Field.Label for="s-self-freeze">Member self-freeze — days/year</Field.Label>
							<Input
								id="s-self-freeze"
								type="number"
								min={0}
								max={365}
								bind:value={selfFreezeDays}
								placeholder="Off"
							/>
							<Field.Description
								>Let members pause their own plan in the portal up to this many days per calendar
								year (no freeze fee, no approval needed). Blank or 0 = staff only.</Field.Description
							>
						</Field.Field>
						<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
							<div>
								<p class="font-medium">Public join page</p>
								<p class="text-xs text-muted-foreground">
									Show plans and the weekly schedule on your public join page.
								</p>
							</div>
							<Switch bind:checked={publicPage} />
						</div>
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="font-medium">Daily staff briefing</p>
								<p class="text-xs text-muted-foreground">
									Morning email to owners/admins — today's classes, member requests, birthdays,
									joins.
								</p>
							</div>
							<Switch bind:checked={staffBriefing} />
						</div>
						<div class="flex items-center justify-between gap-4">
							<div>
								<p class="font-medium">First class free</p>
								<p class="text-xs text-muted-foreground">
									A member's first-ever drop-in books without posting the charge. Still requires a
									drop-in price on the class.
								</p>
							</div>
							<Switch bind:checked={firstClassFree} />
						</div>
						{#if entitlements.whiteLabel}
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">White label</p>
									<p class="text-xs text-muted-foreground">
										Hide "Powered by Freeweight" on the public join page.
									</p>
								</div>
								<Switch bind:checked={whiteLabel} />
							</div>
						{/if}
						{#if entitlements.kioskPin}
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">Kiosk PIN</p>
									<p class="text-xs text-muted-foreground">
										Require a staff PIN before the front-desk kiosk opens.
									</p>
								</div>
								<Input
									class="w-28"
									inputmode="numeric"
									placeholder="4 digits"
									bind:value={kioskPin}
								/>
							</div>
						{/if}
						{#if entitlements.dataRetention}
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">Data retention</p>
									<p class="text-xs text-muted-foreground">
										Purge audit + notification logs older than N days. 0 keeps everything.
									</p>
								</div>
								<Input class="w-28" type="number" min="0" max="3650" bind:value={retentionDays} />
							</div>
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">Auto-anonymize after</p>
									<p class="text-xs text-muted-foreground">
										Nightly sweep scrubs members inactive this many months. 0 = manual only.
									</p>
								</div>
								<Input class="w-28" type="number" min="0" max="120" bind:value={anonymizeMonths} />
							</div>
						{/if}
						{#if entitlements.dataRetention}
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">Anonymize inactive members</p>
									<p class="text-xs text-muted-foreground">
										Scrub personal details of members with no visit in 24+ months (GDPR).
									</p>
								</div>
								<Button
									type="button"
									variant="outline"
									disabled={anonBusy}
									onclick={async () => {
										if (!confirm('Scrub personal details of long-inactive members?')) return;
										anonBusy = true;
										try {
											const r = await anonymizeInactiveMembers({});
											toast.success(`Anonymized ${r.anonymized} members`);
										} catch (err) {
											toast.error(errMsg(err, 'Failed'));
										} finally {
											anonBusy = false;
										}
									}}>Anonymize</Button
								>
							</div>
						{/if}
						{#if entitlements.doorAccess}
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">Door access webhook</p>
									<p class="text-xs text-muted-foreground">
										POST each member check-in to this URL (Kisi/Brivo-style door systems).
									</p>
								</div>
								<div class="flex items-center gap-2">
									<Input class="w-56" placeholder="https://…" bind:value={doorWebhookUrl} />
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={doorBusy}
										onclick={async () => {
											doorBusy = true;
											try {
												await testDoorWebhook();
												toast.success('Test ping sent');
											} catch (err) {
												toast.error(errMsg(err, 'Failed'));
											} finally {
												doorBusy = false;
											}
										}}>Test</Button
									>
								</div>
							</div>
						{/if}
						{#if entitlements.auditExport}
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">Weekly export webhook</p>
									<p class="text-xs text-muted-foreground">
										POST the full org data export (JSON, signed) here every Monday.
									</p>
								</div>
								<Input class="w-56" placeholder="https://…" bind:value={exportWebhookUrl} />
							</div>
						{/if}
						{#if entitlements.whiteLabel}
							<div class="flex items-center justify-between gap-4">
								<div>
									<p class="font-medium">Brand color</p>
									<p class="text-xs text-muted-foreground">
										Accent color on the join page and member portal (hex, blank = default).
									</p>
								</div>
								<Input class="w-28" placeholder="#0ea5e9" bind:value={brandColor} />
							</div>
						{/if}
						<Button type="submit" disabled={pending}>Save</Button>
					</form>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Opening hours</Card.Title>
					<Card.Description
						>Shown on the gym's public timetable. Saved with the General settings above.</Card.Description
					>
				</Card.Header>
				<Card.Content class="space-y-2">
					{#each hourDays as d, i (d)}
						<div class="flex items-center gap-3 text-sm">
							<span class="w-10 font-medium">{d}</span>
							<Input
								type="time"
								class="h-8 w-28"
								disabled={hours[i].closed}
								bind:value={hours[i].open}
							/>
							<span class="text-muted-foreground">–</span>
							<Input
								type="time"
								class="h-8 w-28"
								disabled={hours[i].closed}
								bind:value={hours[i].close}
							/>
							<label class="flex items-center gap-1.5 text-xs text-muted-foreground">
								<input type="checkbox" class="size-3.5" bind:checked={hours[i].closed} /> Closed
							</label>
						</div>
					{/each}
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Closures</Card.Title>
					<Card.Description>
						Days the gym is closed. Adding one cancels that day's sessions and emails the attendees;
						recurring rules skip closed days.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4">
					<form class="flex flex-wrap items-end gap-2" onsubmit={submitClosure}>
						<Field.Field>
							<Field.Label>Date</Field.Label>
							<Input type="date" bind:value={cDate} required />
						</Field.Field>
						<Field.Field class="min-w-40 flex-1">
							<Field.Label>Reason (optional)</Field.Label>
							<Input bind:value={cReason} placeholder="Holiday, maintenance…" />
						</Field.Field>
						<Button type="submit" disabled={cPending}>Add</Button>
					</form>
					<form class="flex flex-wrap items-end gap-2 border-t pt-4" onsubmit={submitFreezeAll}>
						<Field.Field>
							<Field.Label>Holiday freeze — resume date</Field.Label>
							<Input type="date" bind:value={fzUntil} required />
						</Field.Field>
						<Button type="submit" variant="outline" disabled={fzPending}>Freeze all plans</Button>
						<p class="w-full text-xs text-muted-foreground">
							Pauses every active plan until that date (packs are untouched). Members auto-resume
							and get their welcome-back email as usual.
						</p>
					</form>
					<ul class="divide-y">
						{#each closures as c (c.id)}
							<li class="flex items-center justify-between py-2.5 text-sm">
								<div>
									<p class="font-medium">{formatDate(c.date)}</p>
									{#if c.reason}<p class="text-xs text-muted-foreground">{c.reason}</p>{/if}
								</div>
								<Button variant="ghost" size="icon" onclick={() => delClosure(c.id)}
									><Trash class="size-4" /></Button
								>
							</li>
						{:else}
							<p class="py-2 text-sm text-muted-foreground">No closures scheduled.</p>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Join page</Card.Title>
					<Card.Description>
						The gym's public sign-up link — print the QR for the front desk or share it anywhere.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					<div class="flex flex-wrap items-center gap-5">
						{#if joinQr}
							<img src={joinQr} alt="Join page QR" class="size-36 rounded-md border" />
						{/if}
						<div class="min-w-56 flex-1 space-y-3">
							<p class="rounded-md border bg-muted/40 px-3 py-2 font-mono text-xs break-all">
								{joinInfo.url}
							</p>
							{#if !publicPage}
								<p class="text-xs text-muted-foreground">
									The public join page is off — turn it on above before sharing this link.
								</p>
							{/if}
							<div class="flex flex-wrap gap-2">
								<Button size="sm" variant="outline" onclick={() => copyJoinLink()}
									><Copy /> Copy link</Button
								>
								<Button size="sm" variant="outline" onclick={() => copyJoinLink(true)}
									>Timetable link</Button
								>
								<Button
									size="sm"
									variant="outline"
									onclick={() => window.open(joinInfo.url, '_blank')}><ExternalLink /> Open</Button
								>
								<Button
									size="sm"
									variant="outline"
									onclick={() => window.print()}
									disabled={!joinQr}><Printer /> Print poster</Button
								>
							</div>
						</div>
					</div>
				</Card.Content>
			</Card.Root>

			<Card.Root>
				<Card.Header>
					<div class="flex items-center gap-2">
						<Card.Title class="text-base">Custom member fields</Card.Title>
						<Badge variant="secondary">Enterprise</Badge>
					</div>
					<Card.Description>
						Extra fields on member records — shirt sizes, referral codes, whatever your gym tracks.
						They edit on the member page and export in the members CSV.
					</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-2">
					{#if !memberFields.licensed}
						<p class="text-sm text-muted-foreground">
							Custom fields are available on Freeweight Cloud and licensed self-hosted installs.
						</p>
					{:else}
						{#each memberFields.fields as fld (fld.id)}
							<div class="flex items-center justify-between gap-2 border-b pb-2 last:border-0">
								<div>
									<p class="text-sm font-medium">{fld.name}</p>
									<p class="text-xs text-muted-foreground">
										{fld.kind}{fld.kind === 'select' && fld.options ? ` — ${fld.options}` : ''} · {fld.members}
										filled
									</p>
								</div>
								<div class="flex gap-2">
									<Button size="sm" variant="ghost" onclick={() => openCfField(fld)}>Edit</Button>
									<Button
										size="sm"
										variant="ghost"
										class="text-destructive"
										onclick={async () => {
											if (!confirm(`Delete "${fld.name}" and its values?`)) return;
											try {
												await deleteMemberFieldCmd({ id: fld.id });
												toast.success('Field deleted');
											} catch (e) {
												toast.error(errMsg(e, 'Something went wrong'));
											}
										}}>Delete</Button
									>
								</div>
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">No fields yet.</p>
						{/each}
						<Button size="sm" variant="outline" onclick={() => openCfField()}
							><Plus class="mr-1 h-4 w-4" /> Add field</Button
						>
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root class="max-w-2xl">
				<Card.Header>
					<div class="flex items-center gap-2">
						<Card.Title class="text-base">Data export</Card.Title>
						<Badge variant="secondary">Enterprise</Badge>
					</div>
					<Card.Description>
						Full-org JSON dump for compliance and backups — members, plans, memberships, classes,
						bookings, check-ins, charges, payments and the activity log.
					</Card.Description>
				</Card.Header>
				<Card.Content>
					{#if !entitlements.auditExport}
						<p class="text-sm text-muted-foreground">
							Data export is available on Freeweight Cloud and licensed self-hosted installs.
						</p>
					{:else}
						<Button size="sm" variant="outline" disabled={exportBusy} onclick={exportOrgData}>
							{exportBusy ? 'Exporting…' : 'Download JSON'}
						</Button>
					{/if}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="locations">
			<Card.Root class="max-w-2xl">
				<Card.Header class="flex-row items-center justify-between">
					<div>
						<Card.Title class="text-base">Locations</Card.Title>
						<Card.Description>Rooms, sites, or buildings members can check in to.</Card.Description>
					</div>
					<Button size="sm" variant="outline" onclick={() => (locOpen = true)}><Plus /> Add</Button>
				</Card.Header>
				<Card.Content class="px-6">
					<ul class="divide-y">
						{#each locations as l (l.id)}
							<li class="flex items-center justify-between py-3 text-sm">
								<div>
									<p class="font-medium">{l.name}</p>
									{#if l.address}<p class="text-xs text-muted-foreground">{l.address}</p>{/if}
								</div>
								<Button
									variant="ghost"
									size="sm"
									class="h-7 px-2 text-xs"
									onclick={() => archiveLocation(l.id, !l.archivedAt)}
									>{l.archivedAt ? 'Restore' : 'Archive'}</Button
								>
							</li>
						{:else}
							<li class="py-6 text-sm text-muted-foreground">
								No locations — add your gym's site.
							</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>

			<Card.Root class="max-w-2xl">
				<Card.Header class="flex-row items-center justify-between">
					<div>
						<Card.Title class="text-base">Lockers</Card.Title>
						<Card.Description>Locker bank — assign them to members on their page.</Card.Description>
					</div>
					<form class="flex items-center gap-2" onsubmit={addLockerSubmit}>
						<Input placeholder="#42" class="h-8 w-28" bind:value={newLocker} required />
						<Button size="sm" variant="outline" type="submit">Add</Button>
					</form>
				</Card.Header>
				<Card.Content class="px-6">
					<ul class="divide-y">
						{#each lockers as l (l.locker.id)}
							<li class="flex items-center justify-between py-2.5 text-sm">
								<span class="font-medium">{l.locker.label}</span>
								<span class="flex items-center gap-2">
									{#if l.memberName}
										<span class="text-muted-foreground">{l.memberName}</span>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs"
											onclick={async () => {
												await releaseLocker({ id: l.locker.id, memberId: l.locker.memberId! });
												toast.success('Released');
											}}>Release</Button
										>
									{:else}
										<span class="text-muted-foreground">free</span>
										<Button
											variant="ghost"
											size="sm"
											class="h-7 px-2 text-xs text-destructive"
											onclick={async () => {
												await removeLocker(l.locker.id);
												toast.success('Removed');
											}}>Remove</Button
										>
									{/if}
								</span>
							</li>
						{:else}
							<li class="py-6 text-sm text-muted-foreground">No lockers — add your bank above.</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>

			<Card.Root class="max-w-2xl">
				<Card.Header class="flex-row items-center justify-between">
					<div>
						<Card.Title class="text-base">Loanable kit</Card.Title>
						<Card.Description
							>Ropes, bands, mats members can borrow — lent out on their page.</Card.Description
						>
					</div>
					<form class="flex items-center gap-2" onsubmit={addKitSubmit}>
						<Input placeholder="Skipping rope" class="h-8 w-36" bind:value={newKit} required />
						<Input type="number" min={1} class="h-8 w-16" bind:value={newKitQty} required />
						<Button size="sm" variant="outline" type="submit">Add</Button>
					</form>
				</Card.Header>
				<Card.Content class="px-6">
					<ul class="divide-y">
						{#each loanables as k (k.item.id)}
							<li class="flex items-center justify-between py-2.5 text-sm">
								<span class="font-medium">{k.item.name} ×{k.item.quantity}</span>
								<span class="flex items-center gap-2">
									<span class="text-muted-foreground">{k.out > 0 ? `${k.out} out` : 'all in'}</span>
									<Button
										variant="ghost"
										size="sm"
										class="h-7 px-2 text-xs text-destructive"
										onclick={async () => {
											await removeLoanable(k.item.id);
											toast.success('Removed');
										}}>Remove</Button
									>
								</span>
							</li>
						{:else}
							<li class="py-6 text-sm text-muted-foreground">No loanable items yet.</li>
						{/each}
					</ul>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="team">
			<Card.Root class="max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Team</Card.Title>
					<Card.Description>Admins can manage billing, plans and settings.</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-4 px-6">
					<ul class="divide-y">
						{#each staff as s (s.id)}
							<li class="flex items-center justify-between py-3 text-sm">
								<div class="min-w-0">
									<p class="truncate font-medium">{s.name}</p>
									<p class="truncate text-xs text-muted-foreground">{s.email}</p>
								</div>
								<div class="flex items-center gap-2">
									<Badge
										variant={s.role === 'owner' || s.role === 'admin' ? 'default' : 'secondary'}
										>{s.role}</Badge
									>
									{#if s.role !== 'owner'}
										<Button
											variant="ghost"
											size="icon"
											class="size-7"
											onclick={() => removeStaff(s.id)}><Trash class="size-4" /></Button
										>
									{/if}
								</div>
							</li>
						{/each}
					</ul>
					<form class="flex gap-2" onsubmit={invite}>
						<Input
							type="email"
							required
							placeholder="coach@yourgym.com"
							bind:value={inviteEmail}
							class="max-w-xs"
						/>
						<Select.Root type="single" bind:value={inviteRole}>
							<Select.Trigger class="w-28">{inviteRole}</Select.Trigger>
							<Select.Content>
								<Select.Item value="member">member</Select.Item>
								<Select.Item value="admin">admin</Select.Item>
							</Select.Content>
						</Select.Root>
						<Button type="submit" variant="secondary" disabled={pending}>Invite</Button>
					</form>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>

		<Tabs.Content value="payments">
			<div class="max-w-3xl space-y-4">
				{#each providerList as p (p.id)}
					<Card.Root>
						<Card.Header class="flex-row items-start justify-between gap-4">
							<div>
								<Card.Title class="flex items-center gap-2 text-base">
									{p.name}
									{#if !p.configured}<Badge variant="outline">not configured</Badge>
									{:else if p.ready}<Badge>ready</Badge>
									{:else}<Badge variant="secondary">setup needed</Badge>{/if}
								</Card.Title>
								<Card.Description>{p.description}</Card.Description>
							</div>
							<Switch
								checked={p.enabled}
								disabled={!p.configured || !p.ready || !p.supportsCurrency}
								onCheckedChange={async (v) => {
									await toggleProvider({ id: p.id, enabled: v });
									providerList = await getPaymentProviders();
								}}
							/>
						</Card.Header>
						<Card.Content class="space-y-2 px-6 text-sm text-muted-foreground">
							{#if p.hint}<p>{p.hint}</p>{/if}
							{#if !p.configured}
								<p>
									Set
									{#each p.env as e (e)}<code class="rounded bg-muted px-1">{e}</code>
									{/each}
									to enable.
								</p>
							{:else}
								<div class="flex items-center gap-2">
									<code class="rounded bg-muted px-2 py-0.5 text-xs">{p.webhookPath}</code>
									<Button
										variant="ghost"
										size="icon"
										class="size-7"
										onclick={() => copy(`${page.url.origin}${p.webhookPath}`)}
										><Copy class="size-3.5" /></Button
									>
								</div>
								<p class="text-xs">Events: {p.webhookEvents.join(', ')}. {p.webhookNote ?? ''}</p>
								{#if p.canConnect && !p.ready}
									<Button
										size="sm"
										variant="outline"
										onclick={async () => {
											const res = await connectProvider(p.id);
											if (res?.url) location.href = res.url;
										}}><ExternalLink /> Connect {p.name} account</Button
									>
								{/if}
								{#if p.accountId && !p.accountReady}
									<Button
										size="sm"
										variant="ghost"
										onclick={async () => {
											await refreshProvider(p.id);
											providerList = await getPaymentProviders();
										}}>Refresh status</Button
									>
								{/if}
							{/if}
						</Card.Content>
					</Card.Root>
				{/each}
			</div>
		</Tabs.Content>

		<Tabs.Content value="api">
			<div class="max-w-3xl space-y-4">
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">API keys</Card.Title>
						<Card.Description>
							Keys call <code class="rounded bg-muted px-1">/api/v1/…</code> as this workspace. Keep them
							secret — they're shown once.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-4 px-6">
						{#if newKey}
							<div
								class="flex items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3"
							>
								<code class="min-w-0 flex-1 truncate font-mono text-xs">{newKey}</code>
								<Button variant="ghost" size="icon" class="size-7" onclick={() => copy(newKey!)}
									><Copy class="size-3.5" /></Button
								>
							</div>
						{/if}
						<Table.Root>
							<Table.Body>
								{#each apiKeys as k (k.id)}
									<Table.Row>
										<Table.Cell class="font-medium">{k.name}</Table.Cell>
										<Table.Cell class="font-mono text-xs text-muted-foreground"
											>{k.start ?? k.prefix}…</Table.Cell
										>
										<Table.Cell class="text-xs text-muted-foreground"
											>{formatDate(k.createdAt)}</Table.Cell
										>
										<Table.Cell class="text-right">
											<Button
												variant="ghost"
												size="icon"
												class="size-7"
												onclick={() => removeKey(k.id)}><Trash class="size-4" /></Button
											>
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row
										><Table.Cell class="text-muted-foreground">No keys yet.</Table.Cell></Table.Row
									>
								{/each}
							</Table.Body>
						</Table.Root>
						<form class="space-y-3" onsubmit={createKey}>
							<div class="flex gap-2">
								<Input
									required
									placeholder="Key name (e.g. Zapier)"
									bind:value={keyName}
									class="max-w-xs"
								/>
								<Button type="submit" variant="secondary" disabled={pending}>Create key</Button>
							</div>
							<div class="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
								{#each API_RESOURCES as r (r)}
									<label class="flex items-center gap-2">
										<input type="checkbox" bind:checked={keyPerms[r]} class="accent-primary" />
										{r}
									</label>
								{/each}
							</div>
						</form>
					</Card.Content>
				</Card.Root>
			</div>
		</Tabs.Content>

		<Tabs.Content value="webhooks">
			<div class="max-w-3xl space-y-4">
				<Card.Root>
					<Card.Header>
						<Card.Title class="text-base">Webhooks</Card.Title>
						<Card.Description>
							Signed POSTs (HMAC header <code class="rounded bg-muted px-1"
								>x-freeweight-signature</code
							>) for workspace events.
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-4 px-6">
						<Table.Root>
							<Table.Body>
								{#each webhooks as w (w.id)}
									<Table.Row>
										<Table.Cell class="min-w-0 truncate font-mono text-xs">{w.url}</Table.Cell>
										<Table.Cell class="text-xs text-muted-foreground">
											{w.events.length} events{w.lastDeliveryStatus != null
												? ` · last ${w.lastDeliveryStatus || '✕'}`
												: ''}
										</Table.Cell>
										<Table.Cell
											><Switch
												checked={w.enabled}
												onCheckedChange={async (v) => {
													await toggleWebhook({ id: w.id, enabled: v });
													webhooks = await getWebhooks();
												}}
											/></Table.Cell
										>
										<Table.Cell class="text-right">
											<div class="flex items-center justify-end gap-1">
												<Button
													variant="ghost"
													size="sm"
													class="h-7 px-2 text-xs"
													onclick={async () => {
														try {
															const r = await testWebhook(w.id);
															toast.success(
																r.status
																	? `Delivered — HTTP ${r.status}`
																	: 'Could not reach the endpoint'
															);
															webhooks = await getWebhooks();
														} catch (err) {
															toast.error(errMsg(err, 'Test failed'));
														}
													}}>Test</Button
												>
												<Button
													variant="ghost"
													size="icon"
													class="size-7"
													onclick={async () => {
														await deleteWebhook(w.id);
														webhooks = await getWebhooks();
													}}><Trash class="size-4" /></Button
												>
											</div>
										</Table.Cell>
									</Table.Row>
								{:else}
									<Table.Row
										><Table.Cell class="text-muted-foreground">No webhooks.</Table.Cell></Table.Row
									>
								{/each}
							</Table.Body>
						</Table.Root>
						<form class="space-y-3" onsubmit={addWebhook}>
							<Field.Field>
								<Field.Label for="hook-url">Endpoint URL</Field.Label>
								<Input
									id="hook-url"
									type="url"
									required
									placeholder="https://…"
									bind:value={hookUrl}
								/>
							</Field.Field>
							<Field.Field>
								<Field.Label for="hook-events">Events (comma-separated, or *)</Field.Label>
								<Input id="hook-events" bind:value={hookEvents} />
								<Field.Description
									>e.g. member.created, charge.created, payment.recorded</Field.Description
								>
							</Field.Field>
							<Button type="submit" variant="secondary" disabled={pending}>Add webhook</Button>
						</form>
					</Card.Content>
				</Card.Root>
			</div>
		</Tabs.Content>

		<Tabs.Content value="demo">
			<Card.Root class="max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Demo data</Card.Title>
					<Card.Description
						>Load a realistic sample gym — members, plans, a week of classes, check-ins and
						payments. Only on an empty workspace.</Card.Description
					>
				</Card.Header>
				<Card.Content class="px-6">
					<Button
						variant="secondary"
						disabled={pending}
						onclick={async () => {
							pending = true;
							try {
								await seedDemo();
								toast.success('Demo gym loaded — look around');
								await goto('/dashboard', { invalidateAll: true });
							} catch (err) {
								toast.error(errMsg(err, 'Could not seed'));
							}
							pending = false;
						}}><Sparkles /> Load demo data</Button
					>
				</Card.Content>
			</Card.Root>

			<Card.Root class="mt-4 max-w-2xl">
				<Card.Header>
					<Card.Title class="text-base">Product tour</Card.Title>
					<Card.Description
						>The guided walkthrough from your first login — replay it anytime.</Card.Description
					>
				</Card.Header>
				<Card.Content class="px-6">
					<Button variant="secondary" onclick={() => (tour.open = true)}
						><Map /> Take the tour</Button
					>
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>

	<Dialog.Root bind:open={cfOpen}>
		<Dialog.Content>
			<Dialog.Header>
				<Dialog.Title>{cfEditId ? 'Edit field' : 'New member field'}</Dialog.Title>
			</Dialog.Header>
			<div class="space-y-3 py-2">
				<Field.Field>
					<Field.Label>Name</Field.Label>
					<Input bind:value={cfName} placeholder="T-shirt size" />
				</Field.Field>
				<Field.Field>
					<Field.Label>Type</Field.Label>
					<NativeSelect bind:value={cfKind}>
						<option value="text">Text</option>
						<option value="number">Number</option>
						<option value="date">Date</option>
						<option value="select">Dropdown</option>
					</NativeSelect>
				</Field.Field>
				{#if cfKind === 'select'}
					<Field.Field>
						<Field.Label>Options (one per line or comma-separated)</Field.Label>
						<Textarea bind:value={cfOptions} rows={3} placeholder="S, M, L, XL" />
					</Field.Field>
				{/if}
			</div>
			<Dialog.Footer>
				<Button onclick={saveCfField} disabled={cfBusy || !cfName.trim()}
					>{cfBusy ? 'Saving…' : 'Save field'}</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>

<Dialog.Root bind:open={locOpen}>
	<Dialog.Content>
		<Dialog.Header><Dialog.Title>Add location</Dialog.Title></Dialog.Header>
		<form class="space-y-4" onsubmit={addLocation}>
			<Field.Field
				><Field.Label for="loc-name">Name</Field.Label><Input
					id="loc-name"
					required
					bind:value={locName}
					placeholder="Downtown"
					autofocus
				/></Field.Field
			>
			<Dialog.Footer><Button type="submit" disabled={pending}>Add</Button></Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>

<div id="join-poster-print" class="hidden print:block">
	<div class="mx-auto max-w-sm p-8 text-center">
		<p class="text-lg font-semibold tracking-wide uppercase">{joinInfo.name}</p>
		<p class="mt-1 text-3xl font-bold">Join us</p>
		{#if joinQr}<img src={joinQr} alt="Join page QR" class="mx-auto mt-6" />{/if}
		<p class="mt-4 text-sm">Scan to see plans, this week's schedule, and sign up</p>
		<p class="mt-1 font-mono text-xs">{joinInfo.url}</p>
	</div>
</div>

<svelte:head>
	<style>
		@media print {
			body * {
				visibility: hidden;
			}
			#join-poster-print,
			#join-poster-print * {
				visibility: visible;
			}
			#join-poster-print {
				position: absolute;
				top: 0;
				left: 0;
				width: 100%;
			}
		}
	</style>
</svelte:head>
