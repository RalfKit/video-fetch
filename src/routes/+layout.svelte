<script lang="ts">
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';
	import Navbar from '$lib/components/navbar.svelte';
	import Footer from '$lib/components/footer.svelte';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<!-- Fallback title; each route overrides this with its own in <svelte:head>. -->
	<title>Video Fetcher</title>
</svelte:head>

<div class="flex min-h-screen flex-col bg-base-300">
	<Navbar></Navbar>
	<main class="flex w-full flex-1 flex-col items-center py-8">
		{@render children?.()}
	</main>
	<Footer></Footer>
</div>
