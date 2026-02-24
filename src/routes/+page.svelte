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

<div class="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] p-4">
  <Card class="w-full max-w-md p-8 text-center">
    <h1 class="text-4xl font-black uppercase tracking-wider mb-2">
      FREEWEIGHT
    </h1>
    <p class="text-lg font-bold uppercase mb-8">
      Gym Management System
    </p>

    <div class="space-y-4">
      <Button
        onclick={() => goto('/auth/login')}
        class="w-full h-12 text-lg font-black uppercase"
      >
        Sign In
      </Button>
      
      <Button
        onclick={() => goto('/auth/register')}
        variant="outline"
        class="w-full h-12 text-lg font-black uppercase"
      >
        Create Account
      </Button>
    </div>
  </Card>
</div>
