<script lang="ts" context="module">
	const focusSelectedModelIdxByParentId = new Map<string, number>();
</script>

<script lang="ts">
	// @ts-nocheck
	import dayjs from 'dayjs';
	import { onDestroy, onMount, tick, getContext } from 'svelte';

	import { mobile, models, settings, config, TTSWorker } from '$lib/stores';

	import { generateMoACompletion } from '$lib/apis';
	import { createOpenAITextStream } from '$lib/apis/streaming';

	import ResponseMessage from './ResponseMessage.svelte';
	import PodcastPane from './PodcastPane.svelte';
	import PodcastPreviewCard from './PodcastPreviewCard.svelte';
	import Tooltip from '$lib/components/common/Tooltip.svelte';
	import Merge from '$lib/components/icons/Merge.svelte';

	import Markdown from './Markdown.svelte';
	import Name from './Name.svelte';
	import Skeleton from './Skeleton.svelte';
	import { removeAllDetails } from '$lib/utils';
	import {
		buildFallbackWaveformBars,
		buildPodcastAssetCacheKey,
		extractWaveformBarsFromBlob
	} from '$lib/utils/podcast';
	import localizedFormat from 'dayjs/plugin/localizedFormat';
	import { synthesizeOpenAISpeech } from '$lib/apis/audio';
	import { KokoroWorker } from '$lib/workers/KokoroWorker';
	import equal from 'fast-deep-equal';
	const i18n = getContext('i18n');
	dayjs.extend(localizedFormat);

	type PodcastGroup = {
		messageIds: string[];
	};

	export let chatId;
	export let history;
	export let messageId;
	export let selectedModels: any[] = [];

	export let isLastMessage;
	export let readOnly = false;
	export let editCodeBlock = true;

	export let setInputText: Function = () => {};
	export let updateChat: Function;
	export let editMessage: Function;
	export let saveMessage: Function;
	export let rateMessage: Function;
	export let actionMessage: Function;

	export let submitMessage: Function;
	export let deleteMessage: Function;

	export let continueResponse: Function;
	export let regenerateResponse: Function;
	export let mergeResponses: Function;

	export let addMessages: Function;

	export let triggerScroll: Function;

	export let topPadding = false;

	let parentMessage: any;
	let groupedMessageIds: Record<string, PodcastGroup> = {};
	let groupedMessageIdsIdx: Record<string, number> = {};
	let selectedMessageId: string | null = null;

	let selectedModelIdx: number | null = null;
	type PodcastMediaCacheEntry = {
		cacheKey: string;
		audioUrl: string;
		duration: number;
		bars: number[];
	};

	type PodcastPlaybackSnapshot = {
		currentTime: number;
		progress: number;
		duration: number;
	};

	type PodcastSessionState = {
		activeMessageId: string | null;
		playingMessageId: string | null;
	};

	type PodcastQueueState = {
		loadingByMessageId: Record<string, boolean>;
		queueOrderByMessageId: Record<string, number | null>;
		requestsByMessageId: Record<string, Promise<PodcastMediaCacheEntry | null> | null>;
		runId: number;
		running: boolean;
		queueKey: string;
	};

	let podcastMediaCacheByMessageId: Record<string, PodcastMediaCacheEntry> = {};
	let podcastPlaybackSnapshotsByMessageId: Record<string, PodcastPlaybackSnapshot> = {};
	let podcastSession: PodcastSessionState = {
		activeMessageId: null,
		playingMessageId: null
	};
	let podcastQueueState: PodcastQueueState = {
		loadingByMessageId: {},
		queueOrderByMessageId: {},
		requestsByMessageId: {},
		runId: 0,
		running: false,
		queueKey: ''
	};
	let podcastCardMetaByMessageId: Record<string, PodcastCardMeta> = {};
	let podcastSelectedVoice = '';
	let lastPodcastSelectedVoice = '';
	let lastPodcastScopeKey = '';

	type PodcastCardStatus = 'idle' | 'queued' | 'writing' | 'generating_audio' | 'ready' | 'playing';

	type PodcastCardMeta = {
		status: PodcastCardStatus;
		queueOrder: number | null;
		progress: number;
		isActive: boolean;
	};

	const revokePodcastAsset = (asset?: PodcastMediaCacheEntry | null) => {
		if (asset?.audioUrl?.startsWith?.('blob:')) {
			URL.revokeObjectURL(asset.audioUrl);
		}
	};

	const getPodcastAssetCacheKey = (targetMessageId: string) => {
		const targetMessage = history.messages[targetMessageId];
		return buildPodcastAssetCacheKey({
			engine: $settings?.audio?.tts?.engine ?? '',
			voice: podcastSelectedVoice,
			text: removeAllDetails(targetMessage?.content ?? '')
		});
	};

	const hasValidPodcastAsset = (targetMessageId: string) => {
		const cacheKey = getPodcastAssetCacheKey(targetMessageId);
		const asset = podcastMediaCacheByMessageId[targetMessageId];
		return Boolean(asset?.audioUrl && asset.cacheKey === cacheKey);
	};

	const setPodcastPlaybackSnapshot = (
		targetMessageId: string,
		snapshotPatch: Partial<PodcastPlaybackSnapshot>
	) => {
		if (!targetMessageId) return;

		const currentSnapshot = podcastPlaybackSnapshotsByMessageId[targetMessageId] ?? {
			currentTime: 0,
			progress: 0,
			duration: 0
		};

		podcastPlaybackSnapshotsByMessageId = {
			...podcastPlaybackSnapshotsByMessageId,
			[targetMessageId]: {
				...currentSnapshot,
				...snapshotPatch
			}
		};
	};

	const clearPodcastQueueState = () => {
		podcastQueueState = {
			...podcastQueueState,
			loadingByMessageId: {},
			queueOrderByMessageId: {},
			requestsByMessageId: {},
			runId: podcastQueueState.runId + 1,
			running: false,
			queueKey: ''
		};
	};

	const clearPodcastSessionState = () => {
		podcastSession = {
			activeMessageId: null,
			playingMessageId: null
		};
	};

	const invalidatePodcastAsset = (targetMessageId: string) => {
		const existingAsset = podcastMediaCacheByMessageId[targetMessageId];
		if (!existingAsset) return;

		revokePodcastAsset(existingAsset);
		const { [targetMessageId]: _removedAsset, ...restAssets } = podcastMediaCacheByMessageId;
		podcastMediaCacheByMessageId = restAssets;
	};

	const invalidatePodcastAssets = (targetMessageIds: string[]) => {
		for (const candidateId of targetMessageIds) {
			invalidatePodcastAsset(candidateId);
		}
	};

	const pausePodcastSession = () => {
		if (!podcastSession.playingMessageId && !podcastSession.activeMessageId) return;

		podcastSession = {
			...podcastSession,
			playingMessageId: null
		};
	};

	const setPodcastAudioState = (targetMessageId: string, state: string, value: any) => {
		if (!targetMessageId) return;

		if (state === 'playing') {
			podcastSession = {
				activeMessageId: value ? targetMessageId : podcastSession.activeMessageId,
				playingMessageId: value
					? targetMessageId
					: podcastSession.playingMessageId === targetMessageId
						? null
						: podcastSession.playingMessageId
			};
			return;
		}

		if (state === 'loading') {
			podcastQueueState = {
				...podcastQueueState,
				loadingByMessageId: {
					...podcastQueueState.loadingByMessageId,
					[targetMessageId]: Boolean(value)
				},
				queueOrderByMessageId: {
					...podcastQueueState.queueOrderByMessageId,
					[targetMessageId]: value
						? null
						: (podcastQueueState.queueOrderByMessageId[targetMessageId] ?? null)
				}
			};
			return;
		}

		if (state === 'active') {
			podcastSession = {
				...podcastSession,
				activeMessageId: value
					? targetMessageId
					: podcastSession.activeMessageId === targetMessageId
						? null
						: podcastSession.activeMessageId
			};
		}
	};

	const ensurePodcastAudioAsset = async (targetMessageId: string) => {
		if (!targetMessageId) return null;

		const cacheKey = getPodcastAssetCacheKey(targetMessageId);
		const existingAsset = podcastMediaCacheByMessageId[targetMessageId];
		if (existingAsset?.cacheKey === cacheKey) {
			return existingAsset;
		}

		if (existingAsset && existingAsset.cacheKey !== cacheKey) {
			invalidatePodcastAsset(targetMessageId);
		}

		if (podcastQueueState.requestsByMessageId[targetMessageId]) {
			return await podcastQueueState.requestsByMessageId[targetMessageId];
		}

		const request = (async () => {
			const targetMessage = history.messages[targetMessageId];
			if (!targetMessage?.content?.trim()) return null;

			podcastQueueState = {
				...podcastQueueState,
				loadingByMessageId: {
					...podcastQueueState.loadingByMessageId,
					[targetMessageId]: true
				},
				queueOrderByMessageId: {
					...podcastQueueState.queueOrderByMessageId,
					[targetMessageId]: null
				}
			};

			const cleanContent = removeAllDetails(targetMessage.content ?? '');

			let asset: PodcastMediaCacheEntry | null = null;

			try {
				if ($settings?.audio?.tts?.engine === 'browser-kokoro') {
					if (!$TTSWorker) {
						await TTSWorker.set(
							new KokoroWorker({
								dtype: $settings.audio?.tts?.engineConfig?.dtype ?? 'fp32'
							}) as any
						);
						await ($TTSWorker as any).init();
					}

					const audioUrl = await ($TTSWorker as any).generate({
						text: cleanContent,
						voice: podcastSelectedVoice
					});
					asset = {
						cacheKey,
						audioUrl,
						duration: 0,
						bars: buildFallbackWaveformBars(cleanContent || targetMessageId)
					};
				} else {
					const response = await synthesizeOpenAISpeech(
						localStorage.token,
						podcastSelectedVoice,
						cleanContent
					).catch((error) => {
						console.error(error);
						return null;
					});

					if (!response) return null;

					const blob = await response.blob();
					const waveform = await extractWaveformBarsFromBlob(blob).catch(() => null);
					asset = {
						cacheKey,
						audioUrl: URL.createObjectURL(blob),
						duration: waveform?.duration ?? 0,
						bars: waveform?.bars?.length
							? waveform.bars
							: buildFallbackWaveformBars(cleanContent || targetMessageId)
					};
				}

				if (asset) {
					const latestCacheKey = getPodcastAssetCacheKey(targetMessageId);
					if (latestCacheKey === asset.cacheKey) {
						const previousAsset = podcastMediaCacheByMessageId[targetMessageId];
						if (previousAsset && previousAsset.audioUrl !== asset.audioUrl) {
							revokePodcastAsset(previousAsset);
						}

						podcastMediaCacheByMessageId = {
							...podcastMediaCacheByMessageId,
							[targetMessageId]: asset
						};
					} else {
						revokePodcastAsset(asset);
						asset = null;
					}
				}

				return asset;
			} finally {
				podcastQueueState = {
					...podcastQueueState,
					loadingByMessageId: {
						...podcastQueueState.loadingByMessageId,
						[targetMessageId]: false
					}
				};
			}
		})();

		podcastQueueState = {
			...podcastQueueState,
			requestsByMessageId: {
				...podcastQueueState.requestsByMessageId,
				[targetMessageId]: request
			}
		};

		const result = await request;
		podcastQueueState = {
			...podcastQueueState,
			requestsByMessageId: {
				...podcastQueueState.requestsByMessageId,
				[targetMessageId]: null
			}
		};
		return result;
	};

	const queuePodcastAudioGeneration = async (startMessageId: string) => {
		if (displayMode !== 'podcast' || !parentMessage?.childrenIds?.length) return;

		const orderedIds = [
			startMessageId,
			...parentMessage.childrenIds.filter((candidateId) => candidateId !== startMessageId)
		].filter(Boolean);

		const queueKey = orderedIds
			.map(
				(candidateId: string) =>
					`${candidateId}:${hasValidPodcastAsset(candidateId) ? 'ready' : 'pending'}`
			)
			.join(':');

		const nextRunId = podcastQueueState.runId + 1;
		podcastQueueState = {
			...podcastQueueState,
			runId: nextRunId,
			running: true,
			queueKey,
			queueOrderByMessageId: orderedIds.reduce((acc, candidateId, index) => {
				if (
					hasValidPodcastAsset(candidateId) ||
					podcastQueueState.loadingByMessageId[candidateId]
				) {
					return {
						...acc,
						[candidateId]: null
					};
				}

				return {
					...acc,
					[candidateId]: history.messages[candidateId]?.done === false ? index + 1 : index + 1
				};
			}, {})
		};

		for (const candidateId of orderedIds) {
			if (nextRunId !== podcastQueueState.runId) {
				return;
			}

			if (history.messages[candidateId]?.done === false) {
				continue;
			}

			if (hasValidPodcastAsset(candidateId) || podcastQueueState.loadingByMessageId[candidateId]) {
				podcastQueueState = {
					...podcastQueueState,
					queueOrderByMessageId: {
						...podcastQueueState.queueOrderByMessageId,
						[candidateId]: null
					}
				};
				continue;
			}

			try {
				await ensurePodcastAudioAsset(candidateId);
				if (nextRunId !== podcastQueueState.runId) {
					return;
				}
				podcastQueueState = {
					...podcastQueueState,
					queueOrderByMessageId: {
						...podcastQueueState.queueOrderByMessageId,
						[candidateId]: null
					}
				};
			} catch (error) {
				console.error(error);
			}
		}

		if (nextRunId === podcastQueueState.runId) {
			podcastQueueState = {
				...podcastQueueState,
				running: false
			};
		}
	};

	const getPodcastCardMeta = (targetMessageId: string): PodcastCardMeta => {
		const targetMessage = history.messages[targetMessageId];
		if (!targetMessage) {
			return {
				status: 'idle',
				queueOrder: null,
				progress: 0,
				isActive: false
			};
		}

		const progress = Math.min(
			100,
			Math.max(0, podcastPlaybackSnapshotsByMessageId[targetMessageId]?.progress ?? 0)
		);
		const queueOrder = podcastQueueState.queueOrderByMessageId[targetMessageId] ?? null;
		const isActive = podcastSession.activeMessageId === targetMessageId;
		const isPlaying = podcastSession.playingMessageId === targetMessageId;
		const isReady = hasValidPodcastAsset(targetMessageId);
		const isWriting = targetMessage.done === false;
		const isGeneratingAudio = Boolean(
			podcastQueueState.loadingByMessageId[targetMessageId] && !isReady
		);

		let status: PodcastCardStatus = 'idle';

		if (isPlaying) {
			status = 'playing';
		} else if (isReady) {
			status = 'ready';
		} else if (isWriting) {
			status = 'writing';
		} else if (isGeneratingAudio) {
			status = 'generating_audio';
		} else if (queueOrder) {
			status = 'queued';
		} else if (isActive && targetMessage?.content?.trim()) {
			status = 'queued';
		}

		return {
			status,
			queueOrder,
			progress,
			isActive
		};
	};

	$: {
		groupedMessageIds;
		history;
		podcastMediaCacheByMessageId;
		podcastPlaybackSnapshotsByMessageId;
		podcastSession;
		podcastQueueState;

		const nextMetaByMessageId: Record<string, PodcastCardMeta> = {};
		for (const group of Object.values(groupedMessageIds ?? {}) as PodcastGroup[]) {
			for (const candidateId of group?.messageIds ?? []) {
				nextMetaByMessageId[candidateId] = getPodcastCardMeta(candidateId);
			}
		}
		podcastCardMetaByMessageId = nextMetaByMessageId;
	}

	let message = structuredClone(history.messages[messageId]);
	$: if (history.messages) {
		const source = history.messages[messageId];
		if (source) {
			if (message.content !== source.content || message.done !== source.done) {
				message = structuredClone(source);
			} else if (!equal(message, source)) {
				message = structuredClone(source);
			}
		}
	}

	const gotoMessage = async (modelIdx: string | number, messageIdx: number) => {
		const modelKey = String(modelIdx);
		// Clamp messageIdx to ensure it's within valid range
		groupedMessageIdsIdx[modelKey] = Math.max(
			0,
			Math.min(messageIdx, groupedMessageIds[modelKey].messageIds.length - 1)
		);

		// Get the messageId at the specified index
		let messageId = groupedMessageIds[modelKey].messageIds[groupedMessageIdsIdx[modelKey]];
		// Traverse the branch to find the deepest child message
		let messageChildrenIds = history.messages[messageId].childrenIds;
		while (messageChildrenIds.length !== 0) {
			messageId = messageChildrenIds.at(-1);
			messageChildrenIds = history.messages[messageId].childrenIds;
		}

		// Update the current message ID in history
		history.currentId = messageId;

		// Await UI updates
		await tick();
		await updateChat();

		// Trigger scrolling after navigation
		triggerScroll();
	};

	const showPreviousMessage = async (modelIdx: string | number) => {
		const modelKey = String(modelIdx);
		groupedMessageIdsIdx[modelKey] = Math.max(0, groupedMessageIdsIdx[modelKey] - 1);

		let messageId = groupedMessageIds[modelKey].messageIds[groupedMessageIdsIdx[modelKey]];
		let messageChildrenIds = history.messages[messageId].childrenIds;

		while (messageChildrenIds.length !== 0) {
			messageId = messageChildrenIds.at(-1);
			messageChildrenIds = history.messages[messageId].childrenIds;
		}

		history.currentId = messageId;

		await tick();
		await updateChat();
		triggerScroll();
	};

	const showNextMessage = async (modelIdx: string | number) => {
		const modelKey = String(modelIdx);
		groupedMessageIdsIdx[modelKey] = Math.min(
			groupedMessageIds[modelKey].messageIds.length - 1,
			groupedMessageIdsIdx[modelKey] + 1
		);

		let messageId = groupedMessageIds[modelKey].messageIds[groupedMessageIdsIdx[modelKey]];
		let messageChildrenIds = history.messages[messageId].childrenIds;

		while (messageChildrenIds.length !== 0) {
			messageId = messageChildrenIds.at(-1);
			messageChildrenIds = history.messages[messageId].childrenIds;
		}

		history.currentId = messageId;

		await tick();
		await updateChat();
		triggerScroll();
	};

	const initHandler = async () => {
		await tick();
		parentMessage = history.messages[messageId].parentId
			? history.messages[history.messages[messageId].parentId]
			: null;

		groupedMessageIds = parentMessage?.models.reduce(
			(a, model, modelIdx) => {
				// Find all messages that are children of the parent message and have the same model
				let modelMessageIds = parentMessage?.childrenIds
					.map((id) => history.messages[id])
					.filter((m) => m?.modelIdx === modelIdx)
					.map((m) => m.id);

				// Legacy support for messages that don't have a modelIdx
				// Find all messages that are children of the parent message and have the same model
				if (modelMessageIds.length === 0) {
					let modelMessages = parentMessage?.childrenIds
						.map((id) => history.messages[id])
						.filter((m) => m?.model === model);

					modelMessages.forEach((m) => {
						m.modelIdx = modelIdx;
					});

					modelMessageIds = modelMessages.map((m) => m.id);
				}

				return {
					...a,
					[modelIdx]: { messageIds: modelMessageIds }
				};
			},
			{} as Record<string, PodcastGroup>
		);

		groupedMessageIdsIdx = parentMessage?.models.reduce(
			(a, model, modelIdx) => {
				const idx = groupedMessageIds[modelIdx].messageIds.findIndex((id) => id === messageId);
				if (idx !== -1) {
					return {
						...a,
						[modelIdx]: idx
					};
				} else {
					return {
						...a,
						[modelIdx]: groupedMessageIds[modelIdx].messageIds.length - 1
					};
				}
			},
			{} as Record<string, number>
		);

		const initialSelectedModelIdx = history.messages[messageId]?.modelIdx;
		const persistedSelectedModelIdx = parentMessage?.id
			? focusSelectedModelIdxByParentId.get(parentMessage.id)
			: undefined;

		selectedModelIdx =
			persistedSelectedModelIdx !== undefined && groupedMessageIds[persistedSelectedModelIdx]
				? persistedSelectedModelIdx
				: initialSelectedModelIdx;

		await tick();
	};

	const selectModel = (modelIdx: string | number) => {
		selectedModelIdx = Number(modelIdx);
		if (parentMessage?.id && selectedModelIdx !== null) {
			focusSelectedModelIdxByParentId.set(parentMessage.id, selectedModelIdx);
		}
	};

	const selectModelAndOpenGroup = (_messageId: string, modelIdx: string | number) => {
		selectModel(modelIdx);
		onGroupClick(_messageId, Number(modelIdx));
	};

	const onGroupClick = (_messageId: string, modelIdx: string | number) => {
		if (displayMode === 'podcast' && podcastSession.activeMessageId !== _messageId) {
			pausePodcastSession();
			clearPodcastQueueState();
			podcastSession = {
				activeMessageId: _messageId,
				playingMessageId: null
			};
			queuePodcastAudioGeneration(_messageId);
		}
		selectModel(modelIdx);
	};

	$: void generateMoACompletion;
	$: void createOpenAITextStream;
	$: void settings;
	$: void i18n;

	const mergeResponsesHandler = async () => {
		const responses = Object.keys(groupedMessageIds).map((modelIdx) => {
			const { messageIds } = groupedMessageIds[modelIdx];
			const messageId = messageIds[groupedMessageIdsIdx[modelIdx]];

			return history.messages[messageId].content;
		});
		mergeResponses(messageId, responses, chatId);
	};

	const getDisplayMode = () => {
		if ($settings?.multiModelDisplayMode) {
			return $settings.multiModelDisplayMode;
		}

		return $settings?.displayMultiModelResponsesInTabs ? 'tabs' : 'side-by-side';
	};

	$: displayMode = getDisplayMode();
	$: podcastSelectedVoice =
		$settings?.audio?.tts?.podcastVoice ??
		$settings?.audio?.tts?.voice ??
		$config?.audio?.tts?.voice ??
		'alloy';
	$: useTabsLayout = displayMode === 'tabs';
	$: useFocusLayout = displayMode === 'focus' || displayMode === 'podcast';
	$: useMobileFocusLayout = useFocusLayout && $mobile;
	$: selectedMessageId =
		selectedModelIdx !== null && groupedMessageIds[selectedModelIdx]
			? groupedMessageIds[selectedModelIdx].messageIds[groupedMessageIdsIdx[selectedModelIdx]]
			: null;
	$: if (parentMessage?.id && selectedModelIdx !== null) {
		focusSelectedModelIdxByParentId.set(parentMessage.id, selectedModelIdx);
	}
	$: podcastScopeKey =
		displayMode === 'podcast' && parentMessage?.id
			? `${parentMessage.id}:${(parentMessage.childrenIds ?? []).join(':')}`
			: '';
	$: if (displayMode === 'podcast' && podcastScopeKey && podcastScopeKey !== lastPodcastScopeKey) {
		const previousChildIds = lastPodcastScopeKey.split(':').slice(1).filter(Boolean);
		const nextChildIds = parentMessage?.childrenIds ?? [];
		const removedIds = previousChildIds.filter(
			(candidateId) => !nextChildIds.includes(candidateId)
		);

		invalidatePodcastAssets(removedIds);
		if (removedIds.length > 0) {
			podcastPlaybackSnapshotsByMessageId = Object.fromEntries(
				Object.entries(podcastPlaybackSnapshotsByMessageId).filter(
					([candidateId]) => !removedIds.includes(candidateId)
				)
			);
			podcastQueueState = {
				...podcastQueueState,
				loadingByMessageId: Object.fromEntries(
					Object.entries(podcastQueueState.loadingByMessageId).filter(
						([candidateId]) => !removedIds.includes(candidateId)
					)
				),
				queueOrderByMessageId: Object.fromEntries(
					Object.entries(podcastQueueState.queueOrderByMessageId).filter(
						([candidateId]) => !removedIds.includes(candidateId)
					)
				),
				requestsByMessageId: Object.fromEntries(
					Object.entries(podcastQueueState.requestsByMessageId).filter(
						([candidateId]) => !removedIds.includes(candidateId)
					)
				)
			};

			if (
				removedIds.includes(podcastSession.activeMessageId ?? '') ||
				removedIds.includes(podcastSession.playingMessageId ?? '')
			) {
				clearPodcastSessionState();
			}
		}

		lastPodcastScopeKey = podcastScopeKey;
	}
	$: if (displayMode === 'podcast' && podcastSelectedVoice !== lastPodcastSelectedVoice) {
		lastPodcastSelectedVoice = podcastSelectedVoice;
		invalidatePodcastAssets(parentMessage?.childrenIds ?? []);
		clearPodcastQueueState();
	}
	$: if (displayMode === 'podcast' && parentMessage?.childrenIds?.length) {
		for (const candidateId of parentMessage.childrenIds) {
			if (!hasValidPodcastAsset(candidateId)) continue;

			const candidateSnapshot = podcastPlaybackSnapshotsByMessageId[candidateId];
			const candidateAsset = podcastMediaCacheByMessageId[candidateId];
			if (!candidateSnapshot && candidateAsset) {
				setPodcastPlaybackSnapshot(candidateId, {
					currentTime: 0,
					progress: 0,
					duration: candidateAsset.duration ?? 0
				});
			}
		}
	}
	$: if (displayMode !== 'podcast' && lastPodcastSelectedVoice !== '') {
		lastPodcastSelectedVoice = '';
		clearPodcastQueueState();
		clearPodcastSessionState();
	}
	$: if (
		displayMode === 'podcast' &&
		selectedModelIdx !== null &&
		groupedMessageIds[selectedModelIdx]
	) {
		if (!podcastSession.activeMessageId) {
			podcastSession = {
				...podcastSession,
				activeMessageId: selectedMessageId
			};
		}
		queuePodcastAudioGeneration(selectedMessageId);
	}

	onMount(async () => {
		await initHandler();
		await tick();

		if ($settings?.scrollOnBranchChange ?? true) {
			const messageElement = document.getElementById(`message-${messageId}`);
			if (messageElement) {
				messageElement.scrollIntoView({ block: 'start' });
			}
		}
	});

	onDestroy(() => {
		invalidatePodcastAssets(Object.keys(podcastMediaCacheByMessageId));
		clearPodcastQueueState();
		clearPodcastSessionState();
	});
</script>

{#if parentMessage}
	<div>
		<div
			class="flex {useFocusLayout
				? 'overflow-visible snap-none'
				: 'snap-x snap-mandatory overflow-x-auto scrollbar-hidden'}"
			id="responses-container-{chatId}-{parentMessage.id}"
		>
			{#if useTabsLayout}
				<div class="w-full">
					<div class=" flex w-full mb-4.5 border-b border-gray-200 dark:border-gray-850">
						<div
							class="flex gap-2 scrollbar-none overflow-x-auto w-fit text-center font-medium bg-transparent pt-1 text-sm"
							on:wheel|preventDefault={(e) => {
								e.currentTarget.scrollLeft += e.deltaY;
							}}
						>
							{#each Object.keys(groupedMessageIds) as modelIdx}
								{#if groupedMessageIdsIdx[modelIdx] !== undefined && (groupedMessageIds[modelIdx]?.messageIds ?? []).length > 0}
									<!-- svelte-ignore a11y-no-static-element-interactions -->
									<!-- svelte-ignore a11y-click-events-have-key-events -->

									{@const _messageId =
										groupedMessageIds[modelIdx].messageIds[groupedMessageIdsIdx[modelIdx]]}

									{@const model = $models.find((m) => m.id === history.messages[_messageId]?.model)}

									<button
										class="min-w-fit {selectedModelIdx == modelIdx
											? ' dark:border-gray-300 '
											: ' opacity-35 border-transparent'} pb-1.5 px-2.5 transition border-b-2"
										on:click={() => selectModelAndOpenGroup(_messageId, modelIdx)}
									>
										<div class="flex items-center gap-1.5">
											<div class="-translate-y-[1px]">
												{model ? `${model.name}` : history.messages[_messageId]?.model}
											</div>
										</div>
									</button>
								{/if}
							{/each}
						</div>
					</div>

					{#if selectedModelIdx !== null}
						{#key selectedMessageId}
							{#if message}
								<ResponseMessage
									{chatId}
									{history}
									messageId={selectedMessageId}
									{selectedModels}
									isLastMessage={true}
									siblings={groupedMessageIds[selectedModelIdx].messageIds}
									gotoMessage={(message, messageIdx) => gotoMessage(selectedModelIdx, messageIdx)}
									showPreviousMessage={() => showPreviousMessage(selectedModelIdx)}
									showNextMessage={() => showNextMessage(selectedModelIdx)}
									{setInputText}
									{updateChat}
									{editMessage}
									{saveMessage}
									{rateMessage}
									{deleteMessage}
									{actionMessage}
									{submitMessage}
									{continueResponse}
									regenerateResponse={async (message, prompt = null) => {
										regenerateResponse(message, prompt);
										await tick();
										groupedMessageIdsIdx[selectedModelIdx] =
											groupedMessageIds[selectedModelIdx].messageIds.length - 1;
									}}
									{addMessages}
									{readOnly}
									{topPadding}
								/>
							{/if}
						{/key}
					{/if}
				</div>
			{:else if useFocusLayout}
				<div class="w-full flex flex-col gap-4 lg:gap-5 items-start">
					{#if useMobileFocusLayout}
						<div class="w-full -mx-1 px-1 overflow-x-auto scrollbar-hidden">
							<div class="flex gap-3 min-w-full pb-1">
								{#each Object.keys(groupedMessageIds) as modelIdx}
									{#if groupedMessageIdsIdx[modelIdx] !== undefined && groupedMessageIds[modelIdx].messageIds.length > 0}
										{@const previewMessageId =
											groupedMessageIds[modelIdx].messageIds[groupedMessageIdsIdx[modelIdx]]}
										{@const previewCardMeta =
											podcastCardMetaByMessageId[previewMessageId] ??
											getPodcastCardMeta(previewMessageId)}

										<div class="w-[17rem] max-w-[85vw] shrink-0 snap-center">
											{#if displayMode === 'podcast'}
												{#key `${previewMessageId}:${previewCardMeta.status}:${previewCardMeta.queueOrder ?? 'none'}:${Math.round(previewCardMeta.progress)}`}
													<PodcastPreviewCard
														{history}
														messageId={previewMessageId}
														modelIdx={Number(modelIdx)}
														active={selectedModelIdx == modelIdx}
														status={previewCardMeta.status}
														queueOrder={previewCardMeta.queueOrder}
														progress={previewCardMeta.progress}
														bars={podcastMediaCacheByMessageId[previewMessageId]?.bars ??
															buildFallbackWaveformBars(
																history.messages[previewMessageId]?.content ?? previewMessageId,
																32
															)}
														on:select={() => selectModelAndOpenGroup(previewMessageId, modelIdx)}
													/>
												{/key}
											{:else}
												<button
													type="button"
													class="w-full text-left rounded-2xl border p-4 transition {selectedModelIdx ==
													modelIdx
														? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-500/40 dark:bg-emerald-500/10'
														: 'border-gray-200/80 bg-white/80 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/70 dark:hover:border-gray-700'}"
													on:click={() => selectModelAndOpenGroup(previewMessageId, modelIdx)}
												>
													<div
														class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2 truncate"
													>
														{$models.find((m) => m.id === history.messages[previewMessageId]?.model)
															?.name ?? history.messages[previewMessageId]?.model}
													</div>
													<div class="text-xs text-gray-500 dark:text-gray-400 line-clamp-4">
														{history.messages[previewMessageId]?.content ?? ''}
													</div>
												</button>
											{/if}
										</div>
									{/if}
								{/each}
							</div>
						</div>
					{/if}

					<div class="w-full flex flex-col lg:flex-row gap-4 lg:gap-5 items-start">
						<div class="w-full lg:flex-[1.75] min-w-0">
							{#if selectedModelIdx !== null && groupedMessageIds[selectedModelIdx]}
								{#if displayMode === 'podcast'}
									<PodcastPane
										{chatId}
										{history}
										messageId={selectedMessageId}
										audioAsset={hasValidPodcastAsset(selectedMessageId)
											? podcastMediaCacheByMessageId[selectedMessageId]
											: null}
										ensureAudioAsset={ensurePodcastAudioAsset}
										setAudioState={setPodcastAudioState}
										playbackSnapshot={podcastPlaybackSnapshotsByMessageId[selectedMessageId] ??
											null}
										setPlaybackSnapshot={setPodcastPlaybackSnapshot}
										selectedVoice={podcastSelectedVoice}
										{selectedModels}
										isLastMessage={true}
										siblings={groupedMessageIds[selectedModelIdx].messageIds}
										gotoMessage={(message, messageIdx) => gotoMessage(selectedModelIdx, messageIdx)}
										showPreviousMessage={() => showPreviousMessage(selectedModelIdx)}
										showNextMessage={() => showNextMessage(selectedModelIdx)}
										{readOnly}
									/>
								{:else}
									{#key selectedMessageId}
										<ResponseMessage
											{chatId}
											{history}
											messageId={selectedMessageId}
											{selectedModels}
											isLastMessage={true}
											siblings={groupedMessageIds[selectedModelIdx].messageIds}
											gotoMessage={(message, messageIdx) =>
												gotoMessage(selectedModelIdx, messageIdx)}
											showPreviousMessage={() => showPreviousMessage(selectedModelIdx)}
											showNextMessage={() => showNextMessage(selectedModelIdx)}
											{setInputText}
											{updateChat}
											{editMessage}
											{saveMessage}
											{rateMessage}
											{deleteMessage}
											{actionMessage}
											{submitMessage}
											{continueResponse}
											regenerateResponse={async (message, prompt = null) => {
												regenerateResponse(message, prompt);
												await tick();
												groupedMessageIdsIdx[selectedModelIdx] =
													groupedMessageIds[selectedModelIdx].messageIds.length - 1;
											}}
											{addMessages}
											{readOnly}
											{editCodeBlock}
											{topPadding}
										/>
									{/key}
								{/if}
							{/if}
						</div>

						<div class="hidden lg:block w-full lg:w-[22rem] xl:w-[24rem] shrink-0">
							<div class="space-y-3 sticky top-3">
								{#each Object.keys(groupedMessageIds) as modelIdx}
									{#if groupedMessageIdsIdx[modelIdx] !== undefined && groupedMessageIds[modelIdx].messageIds.length > 0}
										{@const previewMessageId =
											groupedMessageIds[modelIdx].messageIds[groupedMessageIdsIdx[modelIdx]]}
										{@const previewCardMeta =
											podcastCardMetaByMessageId[previewMessageId] ??
											getPodcastCardMeta(previewMessageId)}

										{#if displayMode === 'podcast'}
											{#key `${previewMessageId}:${previewCardMeta.status}:${previewCardMeta.queueOrder ?? 'none'}:${Math.round(previewCardMeta.progress)}`}
												<PodcastPreviewCard
													{history}
													messageId={previewMessageId}
													modelIdx={Number(modelIdx)}
													active={selectedModelIdx == modelIdx}
													status={previewCardMeta.status}
													queueOrder={previewCardMeta.queueOrder}
													progress={previewCardMeta.progress}
													bars={podcastMediaCacheByMessageId[previewMessageId]?.bars ??
														buildFallbackWaveformBars(
															history.messages[previewMessageId]?.content ?? previewMessageId,
															32
														)}
													on:select={() => selectModelAndOpenGroup(previewMessageId, modelIdx)}
												/>
											{/key}
										{:else}
											<button
												type="button"
												class="w-full text-left rounded-2xl border p-4 transition {selectedModelIdx ==
												modelIdx
													? 'border-emerald-300 bg-emerald-50/80 dark:border-emerald-500/40 dark:bg-emerald-500/10'
													: 'border-gray-200/80 bg-white/80 hover:border-gray-300 dark:border-gray-800 dark:bg-gray-900/70 dark:hover:border-gray-700'}"
												on:click={() => selectModelAndOpenGroup(previewMessageId, modelIdx)}
											>
												<div class="text-sm font-medium text-gray-900 dark:text-gray-100 mb-2">
													{$models.find((m) => m.id === history.messages[previewMessageId]?.model)
														?.name ?? history.messages[previewMessageId]?.model}
												</div>
												<div class="text-xs text-gray-500 dark:text-gray-400 line-clamp-6">
													{history.messages[previewMessageId]?.content ?? ''}
												</div>
											</button>
										{/if}
									{/if}
								{/each}
							</div>
						</div>
					</div>
				</div>
			{:else}
				{#each Object.keys(groupedMessageIds) as modelIdx}
					{#if groupedMessageIdsIdx[modelIdx] !== undefined && groupedMessageIds[modelIdx].messageIds.length > 0}
						<!-- svelte-ignore a11y-no-static-element-interactions -->
						<!-- svelte-ignore a11y-click-events-have-key-events -->
						{@const _messageId =
							groupedMessageIds[modelIdx].messageIds[groupedMessageIdsIdx[modelIdx]]}

						<div
							class=" snap-center w-full max-w-full m-1 border {history.messages[messageId]
								?.modelIdx == modelIdx
								? `bg-gray-50 dark:bg-gray-850 border-gray-100 dark:border-gray-800 border-2 ${
										$mobile ? 'min-w-full' : 'min-w-80'
									}`
								: `border-gray-100/30 dark:border-gray-850/30 border-dashed ${
										$mobile ? 'min-w-full' : 'min-w-80'
									}`} transition-all p-5 rounded-2xl"
							on:click={async () => {
								onGroupClick(_messageId, modelIdx);
							}}
						>
							{#key history.currentId}
								{#if message}
									<ResponseMessage
										{chatId}
										{history}
										messageId={_messageId}
										{selectedModels}
										isLastMessage={true}
										siblings={groupedMessageIds[modelIdx].messageIds}
										gotoMessage={(message, messageIdx) => gotoMessage(modelIdx, messageIdx)}
										showPreviousMessage={() => showPreviousMessage(modelIdx)}
										showNextMessage={() => showNextMessage(modelIdx)}
										{setInputText}
										{updateChat}
										{editMessage}
										{saveMessage}
										{rateMessage}
										{deleteMessage}
										{actionMessage}
										{submitMessage}
										{continueResponse}
										regenerateResponse={async (message, prompt = null) => {
											regenerateResponse(message, prompt);
											await tick();
											groupedMessageIdsIdx[modelIdx] =
												groupedMessageIds[modelIdx].messageIds.length - 1;
										}}
										{addMessages}
										{readOnly}
										{editCodeBlock}
										{topPadding}
									/>
								{/if}
							{/key}
						</div>
					{/if}
				{/each}
			{/if}
		</div>

		{#if !readOnly}
			{#if !Object.keys(groupedMessageIds).find((modelIdx) => {
				const { messageIds } = groupedMessageIds[modelIdx];
				const _messageId = messageIds[groupedMessageIdsIdx[modelIdx]];
				return !history.messages[_messageId]?.done ?? false;
			})}
				<div class="flex justify-end">
					<div class="w-full">
						{#if history.messages[messageId]?.merged?.status}
							{@const message = history.messages[messageId]?.merged}

							<div class="w-full rounded-xl pl-5 pr-2 py-2 mt-2">
								<Name>
									{$i18n.t('Merged Response')}

									{#if message.timestamp}
										<span
											class=" self-center invisible group-hover:visible text-gray-400 text-xs font-medium uppercase ml-0.5 -mt-0.5"
										>
											{dayjs(message.timestamp * 1000).format('LT')}
										</span>
									{/if}
								</Name>

								<div class="mt-1 markdown-prose w-full min-w-full">
									{#if (message?.content ?? '') === ''}
										<Skeleton />
									{:else}
										<Markdown id={`merged`} content={message.content ?? ''} />
									{/if}
								</div>
							</div>
						{/if}
					</div>

					{#if isLastMessage}
						<div class=" shrink-0 text-gray-600 dark:text-gray-500 mt-1">
							<Tooltip content={$i18n.t('Merge Responses')} placement="bottom">
								<button
									type="button"
									id="merge-response-button"
									class="{true
										? 'visible'
										: 'invisible group-hover:visible'} p-1 hover:bg-black/5 dark:hover:bg-white/5 rounded-lg dark:hover:text-white hover:text-black transition"
									on:click={() => {
										mergeResponsesHandler();
									}}
								>
									<Merge className=" size-5 " />
								</button>
							</Tooltip>
						</div>
					{/if}
				</div>
			{/if}
		{/if}
	</div>
{/if}
