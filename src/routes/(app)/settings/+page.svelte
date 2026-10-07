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
		getStaff,
		getJoinInfo,
		seedDemo
	} from '#lib/remote/workspace.remote.ts';
	import {
		getPaymentProviders,
		toggleProvider,
		connectProvider,
		refreshProvider
	} from '#lib/remote/payments.remote.ts';
	import { getApiKeys, createApiKey, deleteApiKey } from '#lib/remote/api-keys.remote.ts';
	import { getClosures, addClosure, removeClosure } from '#lib/remote/schedule.remote.ts';
	import { API_RESOURCES } from '#lib/api-permissions.ts';
	import { errMsg, formatDate } from '#lib/format.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Copy from '@lucide/svelte/icons/copy';
	import Trash from '@lucide/svelte/icons/trash-2';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import Printer from '@lucide/svelte/icons/printer';
	import Sparkles from '@lucide/svelte/icons/sparkles';

	let settings = $state(await getSettings());
	let locations = $state(await getLocations());
	let webhooks = $state(await getWebhooks());
	let apiKeys = $state(await getApiKeys());
	let providerList = $state(await getPaymentProviders());
	let closures = $state(await getClosures());
	const staff = await getStaff();
	const joinInfo = await getJoinInfo();
	let joinQr = $state('');
	$effect(() => {
		if (joinQr) return;
		void import('qrcode').then((m) =>
			m.default.toDataURL(joinInfo.url, { width: 280, margin: 1 }).then((u: string) => (joinQr = u))
		);
	});
	async function copyJoinLink() {
		await navigator.clipboard.writeText(joinInfo.url);
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

	// ------- general -------
	let timezone = $state(settings.timezone);
	let currency = $state(settings.currency);
	let tagline = $state(settings.tagline);
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
	let suspendAfterDays = $state<number | null>(settings.suspendAfterDays);
	let referralCredits = $state<number | null>(settings.referralCredits);
	let publicPage = $state(settings.publicPage);
	let staffBriefing = $state(settings.staffBriefing);
	const tzOptions = Intl.supportedValuesOf('timeZone');
	const currencyOptions = ['usd', 'eur', 'gbp', 'aud', 'cad', 'nzd', 'brl', 'inr'];
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
				suspendAfterDays,
				referralCredits,
				publicPage,
				staffBriefing
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
						<div class="flex items-center justify-between rounded-lg border p-3 text-sm">
							<div>
								<p class="font-medium">Public join page</p>
								<p class="text-xs text-muted-foreground">
									Show plans and the weekly schedule at /j/{'{slug}'}.
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
						<Button type="submit" disabled={pending}>Save</Button>
					</form>
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
								<Button size="sm" variant="outline" onclick={copyJoinLink}
									><Copy /> Copy link</Button
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
										<Table.Cell class="text-xs text-muted-foreground"
											>{w.events.length} events</Table.Cell
										>
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
											<Button
												variant="ghost"
												size="icon"
												class="size-7"
												onclick={async () => {
													await deleteWebhook(w.id);
													webhooks = await getWebhooks();
												}}><Trash class="size-4" /></Button
											>
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
		</Tabs.Content>
	</Tabs.Root>
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
