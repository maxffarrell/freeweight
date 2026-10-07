<script lang="ts">
	/** The gym whiteboard: scores members logged on a session's workout of the day. */
	let {
		entries,
		memberId
	}: {
		entries: { memberId: string; name: string; score: string; asRx: boolean }[];
		memberId: string;
	} = $props();
</script>

{#if entries.length}
	<div class="mt-1 rounded bg-muted/60 px-2 py-1">
		<p class="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Whiteboard</p>
		{#each entries.slice(0, 8) as e (e.memberId)}
			<p class="text-xs {e.memberId === memberId ? 'font-medium' : 'text-muted-foreground'}">
				{e.name} — {e.score}{e.asRx ? ' Rx' : ''}
			</p>
		{/each}
		{#if entries.length > 8}
			<p class="text-[10px] text-muted-foreground">+{entries.length - 8} more</p>
		{/if}
	</div>
{/if}
