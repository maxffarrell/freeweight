<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authClient } from '#lib/auth-client.ts';
	import { Button } from '#lib/components/ui/button/index.js';
	import { Input } from '#lib/components/ui/input/index.js';
	import * as Field from '#lib/components/ui/field/index.js';
	import { toast } from 'svelte-sonner';

	let name = $state('');
	let email = $state('');
	let password = $state('');
	let pending = $state(false);

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		pending = true;
		const { error } = await authClient.signUp.email({ name, email, password });
		pending = false;
		if (error) return toast.error(error.message ?? 'Could not create account');
		await goto(page.url.searchParams.get('next') ?? '/onboarding', { invalidateAll: true });
	}
</script>

<svelte:head><title>Create account · Freeweight</title></svelte:head>

<form class="flex flex-col gap-6" onsubmit={submit}>
	<div class="space-y-1">
		<h1 class="text-2xl font-semibold tracking-tight">Create your account</h1>
		<p class="text-sm text-muted-foreground">Free to self-host. Takes about a minute.</p>
	</div>
	<Field.Group>
		<Field.Field>
			<Field.Label for="name">Your name</Field.Label>
			<Input id="name" autocomplete="name" required bind:value={name} autofocus />
		</Field.Field>
		<Field.Field>
			<Field.Label for="email">Email</Field.Label>
			<Input id="email" type="email" autocomplete="email" required bind:value={email} />
		</Field.Field>
		<Field.Field>
			<Field.Label for="password">Password</Field.Label>
			<Input
				id="password"
				type="password"
				autocomplete="new-password"
				minlength={8}
				required
				bind:value={password}
			/>
			<Field.Description>At least 8 characters.</Field.Description>
		</Field.Field>
		<Button type="submit" disabled={pending}>{pending ? 'Creating…' : 'Create account'}</Button>
	</Field.Group>
	<p class="text-center text-sm text-muted-foreground">
		Already have an account? <a
			href="/login"
			class="font-medium text-foreground underline-offset-4 hover:underline">Sign in</a
		>
	</p>
</form>
