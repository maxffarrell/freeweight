import LayoutDashboard from '@lucide/svelte/icons/layout-dashboard';
import Users from '@lucide/svelte/icons/users';
import CalendarDays from '@lucide/svelte/icons/calendar-days';
import Wallet from '@lucide/svelte/icons/wallet';
import ScanLine from '@lucide/svelte/icons/scan-line';
import CreditCard from '@lucide/svelte/icons/credit-card';
import Settings from '@lucide/svelte/icons/settings';
import ChartColumn from '@lucide/svelte/icons/chart-column';
import GraduationCap from '@lucide/svelte/icons/graduation-cap';
import History from '@lucide/svelte/icons/history';
import Building2 from '@lucide/svelte/icons/building-2';

/** `key` is the second key of the `g <key>` keyboard shortcut. */
export const mainNav = [
	{ href: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, key: 'd' },
	{ href: '/members', label: 'Members', icon: Users, key: 'm' },
	{ href: '/schedule', label: 'Schedule', icon: CalendarDays, key: 's' },
	{ href: '/checkins', label: 'Check-ins', icon: ScanLine, key: 'c' },
	{ href: '/billing', label: 'Billing', icon: Wallet, key: 'b' },
	{ href: '/plans', label: 'Plans', icon: CreditCard, key: 'p' },
	{ href: '/reports', label: 'Reports', icon: ChartColumn, key: 'r' }
] as const;

export const secondaryNav = [
	{ href: '/my-classes', label: 'My classes', icon: GraduationCap, key: 'y' },
	{ href: '/franchise', label: 'Franchise', icon: Building2, key: 'f' },
	{ href: '/activity', label: 'Activity', icon: History, key: 'a' },
	{ href: '/settings', label: 'Settings', icon: Settings, key: 't' }
] as const;

export const allNav = [...mainNav, ...secondaryNav];
