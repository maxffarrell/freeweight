<script lang="ts">
  import { Card } from '$lib/components/ui/card/index.js';
  import { Calendar, Users, QrCode, Activity } from 'lucide-svelte';
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-3xl font-black uppercase">
      Member Dashboard
    </h1>
    <p class="mt-2 font-bold uppercase opacity-70">
      Welcome to your fitness journey.
    </p>
  </div>

  <!-- Quick Actions -->
  <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
    <a href="/dashboard/member/schedule" class="block">
      <Card class="p-6 hover:shadow-lg transition-shadow cursor-pointer">
        <div class="flex items-center gap-4">
          <Calendar class="w-8 h-8" />
          <div>
            <p class="font-black uppercase">Schedule</p>
            <p class="text-sm opacity-70">Book classes</p>
          </div>
        </div>
      </Card>
    </a>
    <a href="/dashboard/member/friends" class="block">
      <Card class="p-6 hover:shadow-lg transition-shadow cursor-pointer">
        <div class="flex items-center gap-4">
          <Users class="w-8 h-8" />
          <div>
            <p class="font-black uppercase">Friends</p>
            <p class="text-sm opacity-70">Connect with members</p>
          </div>
        </div>
      </Card>
    </a>
    <a href="/qr-code" class="block">
      <Card class="p-6 hover:shadow-lg transition-shadow cursor-pointer">
        <div class="flex items-center gap-4">
          <QrCode class="w-8 h-8" />
          <div>
            <p class="font-black uppercase">Gym Access</p>
            <p class="text-sm opacity-70">Your QR code</p>
          </div>
        </div>
      </Card>
    </a>
  </div>

  <!-- Stats -->
  <Card class="p-6">
    <div class="flex items-center gap-4">
      <Activity class="w-8 h-8" />
      <div>
        <p class="font-black uppercase">Your Streak</p>
        <p class="text-2xl font-black">0 days</p>
      </div>
    </div>
  </Card>
</div>
