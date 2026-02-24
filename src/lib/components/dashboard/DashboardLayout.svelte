<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { auth } from '$lib/auth';
  import { Button } from '$lib/components/ui/button/index.js';
  import { 
    Dumbbell, 
    Users, 
    Calendar, 
    CreditCard, 
    Settings, 
    LogOut,
    Home,
    TrendingUp,
    QrCode,
    UserPlus
  } from 'lucide-svelte';

  let { children } = $props();

  let user = $derived($auth.user);

  function handleLogout() {
    auth.logout();
    goto('/');
  }

  function getNavItems(role: string | undefined) {
    const baseItems = [
      { href: `/dashboard/${role}`, icon: Home, label: 'Dashboard' },
    ];

    if (role === 'owner') {
      return [
        ...baseItems,
        { href: `/dashboard/${role}/members`, icon: Users, label: 'Members' },
        { href: `/dashboard/${role}/classes`, icon: Calendar, label: 'Classes' },
        { href: `/dashboard/${role}/memberships`, icon: CreditCard, label: 'Memberships' },
        { href: `/dashboard/${role}/analytics`, icon: TrendingUp, label: 'Analytics' },
        { href: `/dashboard/${role}/access`, icon: QrCode, label: 'Access Control' },
        { href: `/dashboard/${role}/settings`, icon: Settings, label: 'Settings' },
      ];
    } else if (role === 'trainer') {
      return [
        ...baseItems,
        { href: `/dashboard/${role}/schedule`, icon: Calendar, label: 'Schedule' },
        { href: `/dashboard/${role}/members`, icon: UserPlus, label: 'Members' },
      ];
    } else {
      return [
        ...baseItems,
        { href: `/dashboard/${role}/schedule`, icon: Calendar, label: 'Schedule' },
        { href: `/dashboard/${role}/friends`, icon: Users, label: 'Friends' },
        { href: `/qr-code`, icon: QrCode, label: 'Gym Access' },
      ];
    }
  }

  let navItems = $derived(getNavItems(user?.role));
  let currentPath = $derived($page.url.pathname);
</script>

<div class="min-h-screen bg-white">
  <div class="flex h-screen">
    <!-- Sidebar -->
    <div class="w-64 bg-[#f8f4e5] border-r-[3px] border-black flex flex-col">
      <div class="p-6 border-b-[3px] border-black">
        <a href="/" class="flex items-center gap-2 text-black">
          <Dumbbell class="w-8 h-8" />
          <span class="text-xl font-black uppercase">FreeWeight</span>
        </a>
      </div>

      <nav class="px-4 py-4 space-y-2 flex-1">
        {#each navItems as item}
          {@const isActive = currentPath === item.href}
          <a
            href={item.href}
            class="flex items-center gap-3 px-4 py-3 font-bold uppercase text-sm border-[3px] transition-all duration-100 {isActive
              ? 'bg-[#FFFF00] border-black shadow-[4px_4px_0_0_#000]'
              : 'border-transparent hover:bg-[#FFFF00] hover:border-black hover:shadow-[2px_2px_0_0_#000] hover:translate-x-[-1px] hover:translate-y-[-1px]'}"
          >
            <item.icon class="w-5 h-5" />
            <span>{item.label}</span>
          </a>
        {/each}
      </nav>

      <div class="p-4 border-t-[3px] border-black">
        <div class="bg-white border-[3px] border-black p-2 mb-3 shadow-[2px_2px_0_0_#000]">
          <div class="font-black text-black uppercase text-xs truncate leading-tight">
            {user?.name || 'User'}
          </div>
          <div class="text-[10px] font-bold text-black capitalize opacity-70">
            {user?.role || 'member'}
          </div>
        </div>
        
        <Button
          variant="destructive"
          class="w-full flex items-center justify-center gap-1 text-xs py-2 px-2"
          onclick={handleLogout}
        >
          <LogOut class="w-3 h-3" />
          <span class="truncate">Sign Out</span>
        </Button>
      </div>
    </div>

    <!-- Main Content -->
    <div class="flex-1 flex flex-col overflow-hidden">
      <!-- Header -->
      <div class="bg-white border-b-[3px] border-black p-4 flex justify-end">
        <!-- Theme switcher placeholder -->
      </div>
      
      <main class="flex-1 overflow-auto p-6 bg-[#dfe5f2]">
        {@render children()}
      </main>
    </div>
  </div>
</div>
