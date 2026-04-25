<script lang="ts">
	// @ts-nocheck
	type PodcastAudioAsset = {
		cacheKey?: string;
		audioUrl: string;
		duration: number;
		bars: number[];
	};

	type PodcastPlaybackSnapshot = {
		currentTime: number;
		progress: number;
		duration: number;
	};

	import { getContext, onMount, tick } from 'svelte';
	import dayjs from 'dayjs';
	import localizedFormat from 'dayjs/plugin/localizedFormat';
	import { config, models, settings } from '$lib/stores';
	import { removeAllDetails } from '$lib/utils';
	import {
		buildFallbackWaveformBars,
		buildPodcastSegments,
		scalePodcastSegmentsToDuration
	} from '$lib/utils/podcast';
	import PodcastTranscript from './PodcastTranscript.svelte';

	dayjs.extend(localizedFormat);

	const i18n = getContext('i18n');

	export let chatId = '';
	export let history;
	export let messageId: string;
	export let audioAsset: PodcastAudioAsset | null = null;
	export let ensureAudioAsset: Function = async () => null;
	export let setAudioState: Function = () => {};
	export let playbackSnapshot: PodcastPlaybackSnapshot | null = null;
	export let setPlaybackSnapshot: Function = () => {};
	export let selectedVoice = '';
	export let selectedModels: any[] = [];
	export let siblings: string[] = [];
	export let isLastMessage = true;
	export let readOnly = false;
	export let gotoMessage: Function = () => {};
	export let showPreviousMessage: Function = () => {};
	export let showNextMessage: Function = () => {};

	let audioElement: HTMLAudioElement;
	let loadingAudio = false;
	let audioUrl = '';
	let currentTime = 0;
	let duration = 0;
	let waveformBars: number[] = [];
	let playing = false;
	let waveformContainer: HTMLDivElement;
	let registeredPlaying = false;
	let availableVoices: { id: string; name: string }[] = [];
	let playbackPendingAfterGesture = false;
	let playbackResumeNotice = false;

	const getKokoroVoicesUrl = () => {
		const configuredBaseUrl = ($config as any)?.audio?.tts?.OPENAI_API_BASE_URL;
		if (configuredBaseUrl) {
			try {
				const url = new URL(configuredBaseUrl);
				if (url.hostname === 'kokoro-fastapi-cpu') {
					url.protocol = window.location.protocol;
					url.hostname = window.location.hostname;
					url.port = '8880';
				}
				url.pathname = '/v1/audio/voices';
				url.search = '';
				url.hash = '';
				return url.toString();
			} catch (error) {
				console.error(error);
			}
		}

		return `${window.location.protocol}//${window.location.hostname}:8880/v1/audio/voices`;
	};

	let lastMessageId = '';

	$: message = history?.messages?.[messageId];
	$: model = $models.find((entry) => entry.id === message?.model);
	$: cleanContent = removeAllDetails(message?.content ?? '');
	$: resolvedVoice = selectedVoice || ($config as any)?.audio?.tts?.voice || 'alloy';
	$: baseTranscriptSegments = buildPodcastSegments(
		cleanContent,
		($config as any)?.audio?.tts?.split_on ?? 'punctuation'
	);
	$: transcriptSegments = scalePodcastSegmentsToDuration(baseTranscriptSegments, duration);
	$: activeSegmentIndex = (() => {
		if (!transcriptSegments.length) return -1;

		const exactIndex = transcriptSegments.findIndex(
			(segment) => currentTime >= segment.start && currentTime < segment.end
		);

		if (exactIndex >= 0) return exactIndex;
		if (currentTime <= 0) return 0;

		const nextIndex = transcriptSegments.findIndex((segment) => currentTime < segment.end);
		return nextIndex >= 0 ? nextIndex : transcriptSegments.length - 1;
	})();
	$: percent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
	$: if (waveformBars.length === 0) {
		waveformBars = buildFallbackWaveformBars(cleanContent || messageId || 'waveform');
	}
	let pendingRestoreTime: number | null = null;

	const persistPlaybackSnapshotFor = (
		targetMessageId: string | undefined,
		snapshotPatch: Partial<PodcastPlaybackSnapshot> = {}
	) => {
		if (!targetMessageId) return;

		setPlaybackSnapshot(targetMessageId, {
			currentTime,
			progress: duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0,
			duration,
			...snapshotPatch
		});
	};

	const persistPlaybackSnapshot = (snapshotPatch: Partial<PodcastPlaybackSnapshot> = {}) => {
		persistPlaybackSnapshotFor(messageId, snapshotPatch);
	};

	async function ensureAudio(force = false) {
		const finishLoading = () => {
			loadingAudio = false;
			setAudioState(messageId, 'loading', false);
		};

		if (audioAsset?.audioUrl && audioUrl !== audioAsset.audioUrl) {
			audioUrl = audioAsset.audioUrl;
			duration = audioAsset.duration ?? duration;
			waveformBars = audioAsset.bars?.length ? audioAsset.bars : waveformBars;
			pendingRestoreTime = playbackSnapshot?.currentTime ?? 0;
			finishLoading();
			return audioUrl;
		}

		if ((!force && (audioUrl || loadingAudio)) || !message?.content?.trim()) return audioUrl;

		loadingAudio = true;
		setAudioState(messageId, 'loading', true);

		if (ensureAudioAsset) {
			const asset = await ensureAudioAsset(messageId);
			if (asset?.audioUrl) {
				audioUrl = asset.audioUrl;
				duration = asset.duration ?? duration;
				waveformBars = asset.bars?.length ? asset.bars : waveformBars;
				pendingRestoreTime = playbackSnapshot?.currentTime ?? 0;
				finishLoading();
				return audioUrl;
			}
		}
		finishLoading();
		return audioUrl;
	}

	const syncPlayingState = () => {
		setAudioState(messageId, 'playing', playing);
	};

	const onLoadedMetadata = async () => {
		duration = audioElement?.duration ?? 0;
		const nextTime = Math.min(
			pendingRestoreTime ?? playbackSnapshot?.currentTime ?? 0,
			duration || 0
		);
		await tick();
		if (audioElement && Number.isFinite(nextTime) && nextTime > 0) {
			audioElement.currentTime = nextTime;
			currentTime = nextTime;
		}
		pendingRestoreTime = null;
		persistPlaybackSnapshot({ duration, currentTime });
		onTimeUpdate();
	};

	const onTimeUpdate = () => {
		currentTime = audioElement?.currentTime ?? 0;
		playing = audioElement ? !audioElement.paused && !audioElement.ended : false;
		persistPlaybackSnapshot();
	};

	const onPlay = () => {
		playing = true;
		syncPlayingState();
	};

	const onPause = () => {
		playing = false;
		syncPlayingState();
		persistPlaybackSnapshot();
	};

	const playAudioElement = async () => {
		if (!audioElement || !audioUrl) return false;

		try {
			await audioElement.play();
			playbackPendingAfterGesture = false;
			playbackResumeNotice = false;
			playing = true;
			syncPlayingState();
			return true;
		} catch (error) {
			console.error('podcast autoplay failed', error);
			playbackPendingAfterGesture = true;
			playbackResumeNotice = true;
			playing = false;
			syncPlayingState();
			return false;
		}
	};

	const onSeek = (event: Event) => {
		const target = event.currentTarget as HTMLInputElement;
		const value = Number(target.value);
		if (audioElement) {
			audioElement.currentTime = value;
			currentTime = value;
		}
		playing = audioElement ? !audioElement.paused && !audioElement.ended : false;
		persistPlaybackSnapshot({ currentTime: value });
	};

	const seekFromWaveform = (clientX: number) => {
		if (!waveformContainer || !duration || !audioElement) return;
		const rect = waveformContainer.getBoundingClientRect();
		const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
		const nextTime = duration * ratio;
		audioElement.currentTime = nextTime;
		currentTime = nextTime;
		playing = audioElement ? !audioElement.paused && !audioElement.ended : false;
		persistPlaybackSnapshot({ currentTime: nextTime });
	};

	const onWaveformPointerDown = async (event: PointerEvent) => {
		await ensureAudio();
		seekFromWaveform(event.clientX);
		(event.currentTarget as Element | null)?.setPointerCapture?.(event.pointerId);
		if (playbackPendingAfterGesture) {
			await playAudioElement();
		}
	};

	const onWaveformPointerMove = (event: PointerEvent) => {
		if ((event.buttons & 1) !== 1) return;
		seekFromWaveform(event.clientX);
	};

	const togglePlayback = async () => {
		playbackResumeNotice = false;
		const ensuredAudioUrl = await ensureAudio();
		if (!audioUrl && ensuredAudioUrl) {
			audioUrl = ensuredAudioUrl;
		}
		if (!audioElement || !audioUrl) return;

		if (audioElement.paused) {
			await playAudioElement();
		} else {
			audioElement.pause();
			playbackPendingAfterGesture = false;
			playing = false;
			syncPlayingState();
		}
	};

	const formatTime = (value: number) => {
		if (!Number.isFinite(value)) return '0:00';
		const minutes = Math.floor(value / 60);
		const seconds = Math.floor(value % 60)
			.toString()
			.padStart(2, '0');
		return `${minutes}:${seconds}`;
	};

	$: if (messageId && messageId !== lastMessageId) {
		persistPlaybackSnapshotFor(lastMessageId);
		lastMessageId = messageId;
		if (audioElement) {
			audioElement.pause();
		}
		currentTime = playbackSnapshot?.currentTime ?? 0;
		duration = audioAsset?.duration ?? playbackSnapshot?.duration ?? 0;
		audioUrl = audioAsset?.audioUrl ?? '';
		waveformBars = audioAsset?.bars?.length
			? audioAsset.bars
			: buildFallbackWaveformBars(cleanContent || messageId || 'waveform');
		pendingRestoreTime = playbackSnapshot?.currentTime ?? 0;
		playing = false;
		playbackPendingAfterGesture = false;
		playbackResumeNotice = false;
		syncPlayingState();
	}

	$: if (audioAsset?.audioUrl && audioAsset.audioUrl !== audioUrl) {
		audioUrl = audioAsset.audioUrl;
		duration = audioAsset.duration ?? duration;
		waveformBars = audioAsset.bars?.length ? audioAsset.bars : waveformBars;
		pendingRestoreTime = playbackSnapshot?.currentTime ?? currentTime;
		loadingAudio = false;
	}
	$: if (!audioAsset?.audioUrl) {
		audioUrl = '';
	}
	$: if (messageId && playing !== registeredPlaying) {
		registeredPlaying = playing;
		syncPlayingState();
	}

	onMount(async () => {
		const response = await fetch(getKokoroVoicesUrl())
			.then(async (res) => {
				if (!res.ok) {
					throw new Error(`Unable to load Kokoro voices: ${res.status}`);
				}

				return await res.json();
			})
			.catch(() => null);
		const voices = response?.voices ?? [];
		availableVoices = voices.map((voice: any) => {
			if (typeof voice === 'string') {
				return { id: voice, name: voice };
			}

			return {
				id: voice.id ?? voice.name,
				name: voice.name ?? voice.id
			};
		});
	});

	const updateVoice = async (event: Event) => {
		const voice = (event.currentTarget as HTMLSelectElement).value;
		const updatedSettings = {
			...$settings,
			audio: {
				...$settings?.audio,
				tts: {
					...$settings?.audio?.tts,
					podcastVoice: voice
				}
			}
		};

		await settings.set(updatedSettings as any);
		localStorage.setItem('settings', JSON.stringify(updatedSettings));
	};
</script>

{#if message}
	<div
		class="rounded-[1.75rem] border border-gray-200/80 dark:border-gray-800 bg-gradient-to-br from-white to-gray-50 dark:from-gray-900 dark:to-gray-950 p-4 sm:p-5 md:p-6 shadow-sm"
	>
		<div class="flex flex-col gap-5">
			<div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
				<div>
					<div class="text-xs uppercase tracking-[0.22em] text-gray-500 dark:text-gray-400 mb-2">
						{$i18n.t('Podcast View')}
					</div>
					<div class="text-xl font-semibold text-gray-900 dark:text-gray-100">
						{model?.name ?? message.model}
					</div>
					<div class="text-sm text-gray-500 dark:text-gray-400 mt-1">
						{message?.timestamp ? dayjs(message.timestamp * 1000).format('LT') : ''}
					</div>
				</div>

				<div
					class="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400 flex-wrap sm:justify-end"
				>
					{#if availableVoices.length > 0}
						<label
							class="flex items-center gap-2 rounded-full border border-gray-200 dark:border-gray-700 px-3 py-1"
						>
							<span>{$i18n.t('Voice')}</span>
							<select
								class="bg-transparent text-xs outline-hidden"
								value={resolvedVoice}
								on:change={updateVoice}
								aria-label={$i18n.t('Podcast voice')}
							>
								{#each availableVoices as voice}
									<option value={voice.id}>{voice.name}</option>
								{/each}
							</select>
						</label>
					{/if}

					{#if siblings.length > 1}
						<div
							class="flex items-center gap-1 rounded-full border border-gray-200 dark:border-gray-700 px-2 py-1"
						>
							<button
								type="button"
								class="rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
								on:click={() => showPreviousMessage(message)}
								aria-label={$i18n.t('Previous message')}
							>
								←
							</button>
							<span>{siblings.indexOf(message.id) + 1}/{siblings.length}</span>
							<button
								type="button"
								class="rounded p-1 hover:bg-black/5 dark:hover:bg-white/5"
								on:click={() => showNextMessage(message)}
								aria-label={$i18n.t('Next message')}
							>
								→
							</button>
						</div>
					{/if}
				</div>
			</div>

			<div
				class="rounded-[1.5rem] border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-950 px-3 sm:px-4 py-4 sm:py-5 text-gray-900 dark:text-white overflow-hidden shadow-sm"
			>
				<div
					bind:this={waveformContainer}
					role="presentation"
					class="flex items-end gap-1 h-28 sm:h-36 md:h-44 relative cursor-pointer touch-none"
					on:pointerdown={onWaveformPointerDown}
					on:pointermove={onWaveformPointerMove}
				>
					{#each waveformBars as bar, index}
						<div
							class="flex-1 rounded-full bg-gray-900/60 dark:bg-white/70"
							style={`height:${bar}% ; opacity:${Math.max(0.25, index / waveformBars.length)}`}
						></div>
					{/each}
					<div
						class="absolute top-0 bottom-0 w-0.5 bg-emerald-500 dark:bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.45)] dark:shadow-[0_0_18px_rgba(52,211,153,0.7)]"
						style={`left:${percent}%`}
					></div>
				</div>
			</div>

			<div class="flex flex-col md:flex-row md:items-center gap-3 md:gap-4">
				<button
					type="button"
					class="rounded-full px-4 py-2 text-sm font-medium transition disabled:opacity-60 {playing
						? 'bg-emerald-500 text-white hover:bg-emerald-400'
						: 'bg-gray-900 text-white dark:bg-white dark:text-gray-900 hover:opacity-90'}"
					on:click={togglePlayback}
					disabled={loadingAudio}
				>
					{#if loadingAudio}
						{$i18n.t('Generating audio...')}
					{:else if playing}
						{$i18n.t('Pause')}
					{:else}
						{$i18n.t('Play')}
					{/if}
				</button>

				{#if playbackResumeNotice}
					<div class="text-xs text-amber-600 dark:text-amber-400 md:max-w-56">
						{$i18n.t('Tap play again after audio finishes loading on mobile browsers.')}
					</div>
				{/if}

				<div class="flex-1 flex flex-col gap-2">
					<input
						type="range"
						min="0"
						max={duration || 0}
						step="0.1"
						value={currentTime}
						on:input={onSeek}
						class="w-full accent-emerald-500"
						disabled={!audioUrl}
					/>
					<div class="flex justify-between text-xs text-gray-500 dark:text-gray-400">
						<span>{formatTime(currentTime)}</span>
						<span>{formatTime(duration)}</span>
					</div>
				</div>
			</div>

			{#key `${messageId}:${activeSegmentIndex}:${Math.floor(currentTime * 10)}`}
				<PodcastTranscript
					segments={transcriptSegments}
					{currentTime}
					activeIndex={activeSegmentIndex}
				/>
			{/key}

			<audio
				bind:this={audioElement}
				src={audioUrl}
				on:loadedmetadata={onLoadedMetadata}
				on:timeupdate={onTimeUpdate}
				on:play={onPlay}
				on:pause={onPause}
				on:ended={() => {
					currentTime = 0;
					playing = false;
					syncPlayingState();
					persistPlaybackSnapshot({ currentTime: 0, progress: 0 });
				}}
				class="hidden"
			></audio>
		</div>
	</div>
{/if}
