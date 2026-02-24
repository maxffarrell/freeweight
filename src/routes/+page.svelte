<script lang="ts">
  import { goto } from '$app/navigation';
  import { auth } from '$lib/auth';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Card } from '$lib/components/ui/card/index.js';

  // Check if user is already logged in
  $effect(() => {
    const unsubscribe = auth.subscribe(state => {
      if (state.user) {
        // Redirect based on role
        if (state.user.role === 'owner') {
          goto('/dashboard/owner');
        } else if (state.user.role === 'trainer') {
          goto('/dashboard/trainer');
        } else {
          goto('/dashboard/member');
        }
      }
    });

    return unsubscribe;
  });
</script>

<div class="min-h-screen flex flex-col items-center justify-center p-4" style="background-color: #dfe5f2;">
  <Card class="w-full max-w-md p-8 text-center nb-card">
    <div class="mb-6">
      <div class="inline-block bg-[#FFFF00] border-[3px] border-black px-4 py-2 mb-4 shadow-[4px_4px_0_0_#000]">
        <span class="text-5xl">🏋️</span>
      </div>
      <h1 class="text-5xl font-black uppercase tracking-wider mb-2 text-black">
        FREEWEIGHT
      </h1>
      <p class="text-lg font-bold uppercase text-black opacity-70">
        Gym Management System
      </p>
    </div>

    <div class="space-y-4">
      <Button
        onclick={() => goto('/auth/login')}
        class="w-full h-14 text-lg font-black uppercase"
      >
        Sign In
      </Button>
      
      <Button
        onclick={() => goto('/auth/register')}
        variant="outline"
        class="w-full h-14 text-lg font-black uppercase"
      >
        Create Account
      </Button>
    </div>
  </Card>
</div>
