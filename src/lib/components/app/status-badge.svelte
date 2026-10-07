<script lang="ts">
	import { cn } from '#lib/utils.js';

	const tones: Record<string, string> = {
		paid: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		occupied: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		done: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		completed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		partial: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
		notice: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
		on_hold: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
		high: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
		draft: 'bg-muted text-muted-foreground',
		pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
		sent: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
		signed: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		void: 'bg-muted text-muted-foreground line-through',
		due: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
		open: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
		in_progress: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
		vacant: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
		overdue: 'bg-red-500/10 text-red-700 dark:text-red-400',
		urgent: 'bg-red-500/10 text-red-700 dark:text-red-400',
		terminated: 'bg-red-500/10 text-red-700 dark:text-red-400',
		published: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		closed: 'bg-muted text-muted-foreground',
		new: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
		reviewing: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
		approved: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		declined: 'bg-red-500/10 text-red-700 dark:text-red-400',
		withdrawn: 'bg-muted text-muted-foreground',
		contacted: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
		touring: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
		applied: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-400',
		leased: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
		lost: 'bg-muted text-muted-foreground',
		waitlist: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
		tour: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
		follow_up: 'bg-violet-500/10 text-violet-700 dark:text-violet-400',
		scheduled: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
		no_show: 'bg-red-500/10 text-red-700 dark:text-red-400',
		cancelled: 'bg-muted text-muted-foreground line-through'
	};

	let { status, class: className = '' }: { status: string; class?: string } = $props();
</script>

<span
	class={cn(
		'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap capitalize',
		tones[status] ?? 'bg-muted text-muted-foreground',
		className
	)}
>
	{status.replace('_', ' ')}
</span>
