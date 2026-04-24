<script lang="ts">
	import type { PodcastSegment } from '$lib/utils/podcast';

export let segments: PodcastSegment[] = [];
export let currentTime = 0;
export let activeIndex = -1;

$: resolvedActiveIndex =
	activeIndex >= 0 ? activeIndex : segments.length > 0 ? 0 : -1;
</script>

{#if segments.length > 0}
	<div class="space-y-2">
		<div class="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
			Transcript
		</div>
		<div class="rounded-2xl border border-gray-200/80 dark:border-gray-800 bg-white/70 dark:bg-gray-900/60 p-4 text-sm leading-7 text-gray-700 dark:text-gray-200">
			{#each segments as segment}
				{@const segmentIsActive = segment.index === resolvedActiveIndex}
				<span
					data-podcast-segment-index={segment.index}
					data-podcast-segment-active={segmentIsActive}
					data-podcast-active-index={resolvedActiveIndex}
					data-podcast-current-time={currentTime}
					class="transition rounded-md px-1 py-0.5 mr-1 inline {segmentIsActive
						? 'bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-100'
						: ''}"
				>
					{segment.text}
				</span>
			{/each}
		</div>
	</div>
{/if}
