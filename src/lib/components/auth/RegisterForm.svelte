<script lang="ts">
  import { auth } from '$lib/auth';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Card } from '$lib/components/ui/card/index.js';

  interface Props {
    defaultRole?: 'owner' | 'member';
  }

  let { defaultRole = 'member' }: Props = $props();

  let name = $state('');
  let email = $state('');
  let password = $state('');
  let passwordConfirm = $state('');
  let role = $state(defaultRole);
  let loading = $state(false);
  let error = $state('');

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';

    if (password !== passwordConfirm) {
      error = 'PASSWORDS DO NOT MATCH';
      loading = false;
      return;
    }

    try {
      const user = await auth.register(
        email,
        password,
        passwordConfirm,
        name,
        role
      );
      
      // Redirect to onboarding
      if (user.role === 'owner') {
        goto('/onboarding/owner');
      } else {
        goto('/onboarding/member');
      }
    } catch (err: any) {
      error = (err.message || 'REGISTRATION FAILED').toUpperCase();
    } finally {
      loading = false;
    }
  }
</script>

<Card class="w-full max-w-md p-8 nb-card">
  <form onsubmit={handleSubmit}>
    <div class="space-y-6">
      <div class="text-center">
        <h2 class="text-3xl font-black uppercase">
          {defaultRole === 'owner' ? 'Create Gym Account' : 'Join Gym'}
        </h2>
        <p class="mt-2 text-sm font-bold uppercase opacity-70">
          {defaultRole === 'owner' ? 'Start managing your gym today' : 'Get started with your fitness journey'}
        </p>
      </div>

      {#if error}
        <div class="bg-[#e74c3c] border-[3px] border-black text-white px-4 py-3 font-bold uppercase shadow-[4px_4px_0_0_#000]">
          {error}
        </div>
      {/if}

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-black uppercase mb-2" for="name">
            Full Name
          </label>
          <Input
            id="name"
            type="text"
            bind:value={name}
            placeholder="ENTER YOUR FULL NAME"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-black uppercase mb-2" for="reg-email">
            Email
          </label>
          <Input
            id="reg-email"
            type="email"
            bind:value={email}
            placeholder="ENTER YOUR EMAIL"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-black uppercase mb-2" for="reg-password">
            Password
          </label>
          <Input
            id="reg-password"
            type="password"
            bind:value={password}
            placeholder="CREATE A PASSWORD"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-black uppercase mb-2" for="password-confirm">
            Confirm Password
          </label>
          <Input
            id="password-confirm"
            type="password"
            bind:value={passwordConfirm}
            placeholder="CONFIRM YOUR PASSWORD"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-black uppercase mb-2" for="role">
            Account Type
          </label>
          <select
            id="role"
            bind:value={role}
            class="flex h-10 w-full rounded-[4px] border-[3px] border-black bg-white px-4 py-2 text-sm font-bold uppercase shadow-[4px_4px_0_0_#000] focus:outline-none focus:shadow-[6px_6px_0_0_#000]"
          >
            <option value="member">GYM MEMBER</option>
            <option value="owner">GYM OWNER</option>
          </select>
        </div>
      </div>

      <Button
        type="submit"
        class="w-full"
        disabled={loading}
      >
        {loading ? 'CREATING ACCOUNT...' : 'CREATE ACCOUNT'}
      </Button>
    </div>
  </form>
</Card>
