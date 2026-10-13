<script lang="ts">
	import * as Card from '#lib/components/ui/card/index.js';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Switch } from '#lib/components/ui/switch/index.js';
	import { Label } from '#lib/components/ui/label/index.js';
	import {
		disconnectProfile,
		getProfileLink,
		setProfileSync,
		syncProfileNow
	} from '#lib/remote/profile.remote.ts';
	import { PROFILE_SCOPE_LABELS, PROFILE_SCOPES } from '#lib/profile.ts';
	import { formatRelative } from '#lib/format.ts';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import UserRound from '@lucide/svelte/icons/user-round';

	const p = $derived(await getProfileLink());
	let busy = $state(false);

	onMount(() => {
		const r = page.url.searchParams.get('profile');
		if (!r) return;
		if (r === 'connected') toast.success('Your Leroa profile is connected');
		else if (r === 'declined') toast.info('Nothing was shared');
		else toast.error('Could not connect your Leroa profile. Try again.');
		const u = new URL(page.url.href);
		u.searchParams.delete('profile');
		replaceState(u, page.state);
	});

	async function run(fn: () => Promise<unknown>, ok?: string) {
		busy = true;
		try {
			await fn();
			if (ok) toast.success(ok);
		} catch (err) {
			toast.error(
				(err as { body?: { message?: string } })?.body?.message ?? 'Something went wrong'
			);
		} finally {
			busy = false;
		}
	}

	async function sync() {
		busy = true;
		try {
			const r = await syncProfileNow();
			if (r.ok) toast.success('Your details are up to date');
			else toast.error('Your Leroa profile was disconnected. Connect it again to keep sharing.');
		} catch {
			toast.error('Could not reach your Leroa profile. Try again later.');
		} finally {
			busy = false;
		}
	}

	const scopeLabels = (scopes: string[]) =>
		PROFILE_SCOPES.filter((s) => scopes.includes(s))
			.map((s) => PROFILE_SCOPE_LABELS[s].label.toLowerCase())
			.join(', ');
</script>

{#if p.hub}
	<Card.Root>
		<Card.Header>
			<Card.Title class="flex items-center gap-2 text-base"
				><UserRound class="size-4" /> Leroa Profile</Card.Title
			>
			<Card.Description>
				{#if p.link}
					Connected to {p.link.hubHost} · sharing {scopeLabels(p.link.scopes)} · updated {formatRelative(
						p.link.syncedAt
					)}
				{:else}
					Keep your details in one profile you can take to any gym in the suite. You choose what
					each one sees.
				{/if}
			</Card.Description>
		</Card.Header>
		{#if p.link}
			<Card.Content class="space-y-3">
				{#if p.link.contact}
					<p class="text-sm">
						{[
							`${p.link.contact.firstName} ${p.link.contact.lastName}`.trim(),
							p.link.contact.email,
							p.link.contact.phone
						]
							.filter(Boolean)
							.join(' · ')}
					</p>
				{/if}
				{#each p.members as m (m.id)}
					<div class="flex items-center justify-between gap-4 rounded-lg border p-3">
						<Label for="sync-{m.id}" class="flex-col items-start gap-0.5 font-normal">
							<span class="font-medium">Keep {m.orgName} up to date</span>
							<span class="text-xs text-muted-foreground"
								>Changes to your name, email and phone are copied over automatically</span
							>
						</Label>
						<Switch
							id="sync-{m.id}"
							checked={m.profileSync}
							disabled={busy || !p.link.scopes.includes('contact')}
							onCheckedChange={(on) =>
								run(
									() => setProfileSync({ memberId: m.id, on }),
									on ? `${m.orgName} now gets your updates` : undefined
								)}
						/>
					</div>
				{/each}
			</Card.Content>
		{/if}
		<Card.Footer class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
			{#if p.link}
				<Button variant="outline" class="w-full sm:w-auto" disabled={busy} onclick={sync}
					>Sync now</Button
				>
				<Button
					variant="ghost"
					class="w-full sm:w-auto"
					disabled={busy}
					onclick={() => run(disconnectProfile, 'Disconnected')}>Disconnect</Button
				>
			{:else}
				<Button class="w-full sm:w-auto" href="/api/profile/connect?next=/portal&keep=1"
					>Connect your Leroa profile</Button
				>
			{/if}
		</Card.Footer>
	</Card.Root>
{/if}
