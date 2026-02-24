<script lang="ts">
  import { auth } from '$lib/auth';
  import { Card } from '$lib/components/ui/card/index.js';
  import { 
    Users, 
    Calendar, 
    CreditCard, 
    TrendingUp,
    Activity,
    DollarSign
  } from 'lucide-svelte';

  let user = $derived($auth.user);

  let stats = $state({
    totalMembers: 0,
    activeMembers: 0,
    upcomingClasses: 0,
    monthlyRevenue: 0,
    weeklyVisits: 0,
    memberGrowth: 0
  });

  // Load dashboard data
  $effect(() => {
    // This would load real data in a real implementation
    // For now, showing the structure
  });

  const statCards = [
    {
      title: 'Total Members',
      value: stats.totalMembers,
      icon: Users,
      color: 'text-blue-600',
      bg: 'bg-blue-100'
    },
    {
      title: 'Active Members',
      value: stats.activeMembers,
      icon: Activity,
      color: 'text-green-600',
      bg: 'bg-green-100'
    },
    {
      title: 'Upcoming Classes',
      value: stats.upcomingClasses,
      icon: Calendar,
      color: 'text-purple-600',
      bg: 'bg-purple-100'
    },
    {
      title: 'Monthly Revenue',
      value: `$${stats.monthlyRevenue.toLocaleString()}`,
      icon: DollarSign,
      color: 'text-green-600',
      bg: 'bg-green-100'
    },
    {
      title: 'Weekly Visits',
      value: stats.weeklyVisits,
      icon: TrendingUp,
      color: 'text-indigo-600',
      bg: 'bg-indigo-100'
    },
    {
      title: 'Member Growth',
      value: `+${stats.memberGrowth}`,
      icon: Users,
      color: stats.memberGrowth >= 0 ? 'text-green-600' : 'text-red-600',
      bg: stats.memberGrowth >= 0 ? 'bg-green-100' : 'bg-red-100'
    }
  ];
</script>

<div class="space-y-6">
  <!-- Header -->
  <div>
    <h1 class="text-3xl font-black uppercase">
      Dashboard
    </h1>
    <p class="mt-2 font-bold uppercase opacity-70">
      Welcome back! Here's your gym overview.
    </p>
  </div>

  <!-- Stats Cards -->
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
    {#each statCards as stat, index}
      {@const Icon = stat.icon}
      <Card class="p-6">
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-medium opacity-70">
              {stat.title}
            </p>
            <p class="text-2xl font-black uppercase">
              {stat.value}
            </p>
          </div>
          <div class="p-3 rounded-full {stat.bg}">
            <Icon class="w-6 h-6 {stat.color}" />
          </div>
        </div>
      </Card>
    {/each}
  </div>

  <!-- Recent Activity -->
  <Card class="p-6">
    <h2 class="text-xl font-black uppercase mb-4">
      Recent Activity
    </h2>
    <p class="opacity-70">Loading recent activity...</p>
  </Card>
</div>
