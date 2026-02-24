<script lang="ts">
  import { Card } from '$lib/components/ui/card/index.js';
  import { Calendar, Users, QrCode } from 'lucide-svelte';
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-3xl font-black uppercase">
      Trainer Dashboard
    </h1>
    <p class="mt-2 font-bold uppercase opacity-70">
      Manage your classes and members.
    </p>
  </div>

  <!-- Quick Actions -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <Card class="p-6">
      <div class="flex items-center gap-4">
        <Calendar class="w-8 h-8" />
        <div>
          <p class="font-black uppercase">Schedule</p>
          <p class="text-sm opacity-70">View your classes</p>
        </div>
      </div>
    </Card>
    <Card class="p-6">
      <div class="flex items-center gap-4">
        <Users class="w-8 h-8" />
        <div>
          <p class="font-black uppercase">Members</p>
          <p class="text-sm opacity-70">Manage your members</p>
        </div>
      </div>
    </Card>
  </div>
</div>
