<script lang="ts">
  import '../app.css';
  import { onMount } from 'svelte';
  import { auth } from '$lib/auth';
  import { theme } from '$lib/theme';
  import favicon from '$lib/assets/favicon.svg';

  let { children } = $props();

  onMount(() => {
    auth.init();
    theme.initTheme();
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
