import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import Users from '@lucide/svelte/icons/users';
import CalendarDays from '@lucide/svelte/icons/calendar-days';
import Wallet from '@lucide/svelte/icons/wallet';
import ScanLine from '@lucide/svelte/icons/scan-line';
import CreditCard from '@lucide/svelte/icons/credit-card';
import Settings from '@lucide/svelte/icons/settings';

/** `key` is the second key of the `g <key>` keyboard shortcut. */
export const mainNav = [
	{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, key: 'd' },
	{ href: '/members', label: 'Members', icon: Users, key: 'm' },
	{ href: '/schedule', label: 'Schedule', icon: CalendarDays, key: 's' },
	{ href: '/checkins', label: 'Check-ins', icon: ScanLine, key: 'c' },
	{ href: '/billing', label: 'Billing', icon: Wallet, key: 'b' },
	{ href: '/plans', label: 'Plans', icon: CreditCard, key: 'p' }
] as const;

export const secondaryNav = [
	{ href: '/settings', label: 'Settings', icon: Settings, key: 't' }
] as const;

export const allNav = [...mainNav, ...secondaryNav];
