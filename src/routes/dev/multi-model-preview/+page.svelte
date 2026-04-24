<script lang="ts">
	import { onMount } from 'svelte';
	import MultiResponseMessages from '$lib/components/chat/Messages/MultiResponseMessages.svelte';
	import { models, settings } from '$lib/stores';

	const chatId = 'preview-chat';
	const selectedModels = ['model-a', 'model-b', 'model-c'];

	let mode: 'tabs' | 'side-by-side' | 'focus' | 'podcast' = 'focus';

	const rootUserId = 'user-root';
	const rootAssistantId = 'assistant-root';
	const history = {
		currentId: 'msg-a',
		messages: {
			[rootUserId]: {
				id: rootUserId,
				role: 'user',
				content: 'Compare these three models and then read them as a podcast.',
				parentId: null,
				childrenIds: [rootAssistantId]
			},
			[rootAssistantId]: {
				id: rootAssistantId,
				role: 'assistant',
				content: '',
				parentId: rootUserId,
				childrenIds: ['msg-a', 'msg-b', 'msg-c'],
				models: selectedModels
			},
			'msg-a': {
				id: 'msg-a',
				role: 'assistant',
				model: 'model-a',
				modelIdx: 0,
				content:
					'Alpha model writes broad, structured summaries. It tends to create stable outlines, clear bullets, and predictable transitions across sections. This makes it good for long-form reading and review.',
				timestamp: 1713100000,
				parentId: rootAssistantId,
				childrenIds: [],
				done: true
			},
			'msg-b': {
				id: 'msg-b',
				role: 'assistant',
				model: 'model-b',
				modelIdx: 1,
				content:
					'Bravo model is tighter and more analytical. It makes direct tradeoff statements, points out contradictions quickly, and tends to be denser per paragraph. This is useful when comparing precision and reasoning style.',
				timestamp: 1713100000,
				parentId: rootAssistantId,
				childrenIds: [],
				done: true
			},
			'msg-c': {
				id: 'msg-c',
				role: 'assistant',
				model: 'model-c',
				modelIdx: 2,
				content:
					'Charlie model is more conversational and narrative. It uses softer transitions, more metaphors, and longer pacing. This makes it pleasant to listen to in podcast form but slightly less compact for scanning.',
				timestamp: 1713100000,
				parentId: rootAssistantId,
				childrenIds: [],
				done: true
			}
		}
	};

	const noop = async () => {};

	onMount(() => {
		models.set([
			{ id: 'model-a', name: 'Alpha Model' },
			{ id: 'model-b', name: 'Bravo Model' },
			{ id: 'model-c', name: 'Charlie Model' }
		] as any);

		settings.set({
			multiModelDisplayMode: mode,
			displayMultiModelResponsesInTabs: false,
			renderMarkdownInPreviews: true,
			scrollOnBranchChange: false,
			highContrastMode: false,
			chatFadeStreamingText: true,
			showFloatingActionButtons: false,
			audio: {
				tts: {
					engine: 'openai',
					voice: 'af_sarah',
					playbackRate: 1
				}
			}
		} as any);
	});

	$: if ($settings?.multiModelDisplayMode !== mode || $settings?.displayMultiModelResponsesInTabs !== (mode === 'tabs')) {
		settings.set({
			...$settings,
			multiModelDisplayMode: mode,
			displayMultiModelResponsesInTabs: mode === 'tabs'
		} as any);
	}
</script>

<svelte:head>
	<title>Multi-model preview</title>
</svelte:head>

<div class="min-h-screen bg-gray-100 dark:bg-black px-4 py-6 md:px-8">
	<div class="max-w-7xl mx-auto space-y-5">
		<div class="rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 p-4">
			<div class="flex flex-col md:flex-row md:items-center gap-4 justify-between">
				<div>
					<div class="text-sm font-medium text-gray-900 dark:text-gray-100">
						Multi-model preview harness
					</div>
					<div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
						Use this local route to validate tabs, side-by-side, focus, and podcast modes.
					</div>
				</div>

				<label class="text-sm flex items-center gap-3">
					<span class="text-gray-600 dark:text-gray-300">Mode</span>
					<select bind:value={mode} class="rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2">
						<option value="tabs">tabs</option>
						<option value="side-by-side">side-by-side</option>
						<option value="focus">focus</option>
						<option value="podcast">podcast</option>
					</select>
				</label>
			</div>
		</div>

		<div data-testid="multi-model-preview-root">
			{#key mode}
				<MultiResponseMessages
					{chatId}
					{history}
					messageId="msg-a"
					{selectedModels}
					isLastMessage={true}
					setInputText={noop}
					updateChat={noop}
					editMessage={noop}
					saveMessage={noop}
					rateMessage={noop}
					actionMessage={noop}
					submitMessage={noop}
					deleteMessage={noop}
					continueResponse={noop}
					regenerateResponse={noop}
					mergeResponses={noop}
					triggerScroll={noop}
					addMessages={noop}
					readOnly={true}
				/>
			{/key}
		</div>
	</div>
</div>
