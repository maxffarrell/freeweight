<script lang="ts">
  import { auth } from '$lib/auth';
  import { Card } from '$lib/components/ui/card/index.js';
  import { Button } from '$lib/components/ui/button/index.js';

  let user = $derived($auth.user);
</script>

<div class="space-y-6">
  <h1 class="text-3xl font-black uppercase">Gym Access</h1>
  
  <Card class="p-6">
    <div class="text-center">
      <p class="font-bold mb-4">Your QR Code</p>
      <div class="bg-white p-4 inline-block border-4 border-black">
        <p class="text-4xl font-black">QR</p>
      </div>
      <p class="mt-4 text-sm font-bold opacity-70">
        {user?.name || 'Member'}
      </p>
    </div>
  </Card>

  <Card class="p-6">
    <p class="font-bold">Show this code at the gym entrance</p>
  </Card>
</div>
