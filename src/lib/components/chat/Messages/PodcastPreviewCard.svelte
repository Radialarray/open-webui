<script lang="ts">
	import localizedFormat from 'dayjs/plugin/localizedFormat';
	import dayjs from 'dayjs';
	import { createEventDispatcher } from 'svelte';
	import { models } from '$lib/stores';

	dayjs.extend(localizedFormat);

	export let history;
	export let messageId;
	export let modelIdx;
	export let active = false;
	export let status:
		| 'idle'
		| 'queued'
		| 'writing'
		| 'generating_audio'
		| 'ready'
		| 'playing' = 'idle';
	export let queueOrder: number | null = null;
	export let progress = 0;
	export let bars: number[] = [];

	const dispatch = createEventDispatcher();

	$: message = history?.messages?.[messageId];
	$: model = $models.find((entry) => entry.id === message?.model);
	$: previewBars =
		bars.length > 0
			? bars
			: Array.from({ length: 32 }, (_, idx) => {
					const seed = `${messageId}-${idx}`
						.split('')
						.reduce((acc, char) => acc + char.charCodeAt(0), 0);
					return 18 + (seed % 48);
				});

	$: previewText = (message?.content ?? '').replace(/<details[\s\S]*?<\/details>/gi, '').trim();

	$: statusLabel =
		status === 'playing'
			? 'Playing'
			: status === 'ready'
				? 'Ready'
				: status === 'writing'
					? 'Generating'
					: status === 'generating_audio'
						? 'Generating audio'
					: status === 'queued'
						? `Queued${queueOrder ? ` #${queueOrder}` : ''}`
						: 'Audio';
</script>

{#if message}
	<button
		type="button"
		class="w-full text-left rounded-2xl border p-4 transition {active
			? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-500/50 dark:bg-emerald-500/10'
			: 'border-gray-200/80 bg-white/80 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/70 dark:hover:border-gray-700'}"
		on:click={() => dispatch('select', { messageId, modelIdx })}
	>
		<div class="flex items-center justify-between gap-2 mb-3">
			<div class="min-w-0">
				<div class="text-sm font-medium truncate text-gray-900 dark:text-gray-100">
					{model?.name ?? message?.model}
				</div>
				<div class="text-xs text-gray-500 dark:text-gray-400">
					{message?.timestamp ? dayjs(message.timestamp * 1000).format('LT') : ''}
				</div>
			</div>
			<div class="flex flex-col items-end gap-1 shrink-0">
				<div class="text-[11px] uppercase tracking-wide text-gray-500 dark:text-gray-400">
					{statusLabel}
				</div>
				{#if queueOrder}
					<div class="text-[10px] text-gray-400 dark:text-gray-500">#{queueOrder}</div>
				{/if}
			</div>
		</div>

		<div class="h-16 rounded-xl bg-gray-100/90 dark:bg-gray-800/80 px-2 py-2 overflow-hidden relative">
			<div class="flex items-end gap-[2px] h-full">
				{#each previewBars as bar}
					<div
						class="flex-1 rounded-full {active
							? 'bg-emerald-500/80 dark:bg-emerald-400/80'
							: 'bg-gray-400/70 dark:bg-gray-500/70'}"
						style={`height:${bar}%`}
					></div>
				{/each}
			</div>
			{#if progress > 0}
				<div
					class="absolute top-1 bottom-1 w-0.5 bg-emerald-500/90 dark:bg-emerald-400/90 rounded-full"
					style={`left:${Math.min(100, Math.max(0, progress))}%`}
				></div>
			{/if}
		</div>

		<div class="mt-3 text-xs text-gray-600 dark:text-gray-300 line-clamp-3">
			{previewText}
		</div>
	</button>
{/if}
