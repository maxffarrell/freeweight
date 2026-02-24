<script lang="ts">
  import { auth } from '$lib/auth';
  import { goto } from '$app/navigation';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Card } from '$lib/components/ui/card/index.js';

  let email = $state('');
  let password = $state('');
  let loading = $state(false);
  let error = $state('');

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    loading = true;
    error = '';

    try {
      const user = await auth.login(email, password);
      
      // Redirect based on user role
      if (user.role === 'owner') {
        goto('/dashboard/owner');
      } else if (user.role === 'trainer') {
        goto('/dashboard/trainer');
      } else {
        goto('/dashboard/member');
      }
    } catch (err: any) {
      error = err.message || 'Login failed';
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
          Sign In
        </h2>
        <p class="mt-2 text-sm font-bold uppercase opacity-70">
          Welcome back to your gym
        </p>
      </div>

      {#if error}
        <div class="bg-[#e74c3c] border-[3px] border-black text-white px-4 py-3 font-bold uppercase shadow-[4px_4px_0_0_#000]">
          {error}
        </div>
      {/if}

      <div class="space-y-4">
        <div>
          <label class="block text-sm font-black uppercase mb-2" for="email">
            Email
          </label>
          <Input
            id="email"
            type="email"
            bind:value={email}
            placeholder="ENTER YOUR EMAIL"
            required
          />
        </div>

        <div>
          <label class="block text-sm font-black uppercase mb-2" for="password">
            Password
          </label>
          <Input
            id="password"
            type="password"
            bind:value={password}
            placeholder="ENTER YOUR PASSWORD"
            required
          />
        </div>
      </div>

      <Button
        type="submit"
        class="w-full"
        disabled={loading}
      >
        {loading ? 'SIGNING IN...' : 'SIGN IN'}
      </Button>
    </div>
  </form>
</Card>
