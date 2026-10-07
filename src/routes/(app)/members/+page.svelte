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
	import * as Select from '#lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import { getMembers, createMember } from '#lib/remote/members.remote.ts';
	import { formatMoney } from '#lib/format.ts';
	import { getCurrency } from '#lib/remote/billing.remote.ts';
	import Plus from '@lucide/svelte/icons/plus';
	import Users from '@lucide/svelte/icons/users';
	import Search from '@lucide/svelte/icons/search';

	const currency = await getCurrency();
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
			toast.error(err instanceof Error ? err.message : 'Could not add member');
		}
		pending = false;
	}
</script>

<PageHeader title="Members">
	{#snippet actions()}
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
