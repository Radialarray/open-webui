<script lang="ts">
	import { models, showSettings, settings, user, mobile } from '$lib/stores';
	import { getContext } from 'svelte';
	import { toast } from 'svelte-sonner';
	import Selector from './ModelSelector/Selector.svelte';
	import Tooltip from '../common/Tooltip.svelte';
	import Modal from '../common/Modal.svelte';
	import XMark from '../icons/XMark.svelte';

	import { updateUserSettings } from '$lib/apis/users';
	import equal from 'fast-deep-equal';
	const i18n = getContext('i18n');

	export let selectedModels = [''];
	export let disabled = false;

	export let showSetDefault = true;
	export let buttonOnly = false;
	export let showDialog = false;
	export let buttonClassName = '';
	export let compactButton = false;

	$: selectedModelNames = selectedModels
		.filter((modelId) => modelId !== '')
		.map((modelId) => $models.find((model) => model.id === modelId)?.name ?? modelId);

	$: buttonLabel = selectedModelNames[0] ?? $i18n.t('Select a model');
	$: buttonBadge = selectedModelNames.length > 1 ? `+${selectedModelNames.length - 1}` : '';

	const saveDefaultModel = async () => {
		const hasEmptyModel = selectedModels.filter((it) => it === '');
		if (hasEmptyModel.length) {
			toast.error($i18n.t('Choose a model before saving...'));
			return;
		}
		settings.set({ ...$settings, models: selectedModels });
		await updateUserSettings(localStorage.token, { ui: $settings });

		toast.success($i18n.t('Default model updated'));
	};

	const pinModelHandler = async (modelId) => {
		let pinnedModels = $settings?.pinnedModels ?? [];

		if (pinnedModels.includes(modelId)) {
			pinnedModels = pinnedModels.filter((id) => id !== modelId);
		} else {
			pinnedModels = [...new Set([...pinnedModels, modelId])];
		}

		settings.set({ ...$settings, pinnedModels: pinnedModels });
		await updateUserSettings(localStorage.token, { ui: $settings });
	};

	$: if (selectedModels.length > 0 && $models.length > 0) {
		const _selectedModels = selectedModels.map((model) =>
			$models.map((m) => m.id).includes(model) ? model : ''
		);

		if (!equal(_selectedModels, selectedModels)) {
			selectedModels = _selectedModels;
		}
	}
</script>

<div class="w-full">
	{#if buttonOnly}
		<button
			id="model-selector-0-button"
			type="button"
			class={`group flex w-full items-center gap-2 rounded-2xl border border-gray-200 bg-white/80 text-left text-sm text-gray-900 shadow-xs transition hover:bg-white dark:border-gray-800 dark:bg-gray-900/80 dark:text-gray-100 dark:hover:bg-gray-900 ${compactButton ? 'min-h-10 px-3 py-2' : 'px-3.5 py-2'} ${buttonClassName}`}
			aria-label={$i18n.t('Select a model')}
			aria-haspopup="dialog"
			aria-expanded={showDialog}
			on:click={() => {
				showDialog = true;
			}}
		>
			<div class="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
				<div
					class="shrink-0 text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
				>
					{$i18n.t('Model')}
				</div>

				<div class="min-w-0 flex-1 truncate font-medium">{buttonLabel}</div>

				{#if buttonBadge}
					<div
						class="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300"
					>
						{buttonBadge}
					</div>
				{/if}
			</div>

			<svg
				xmlns="http://www.w3.org/2000/svg"
				fill="none"
				viewBox="0 0 24 24"
				stroke-width="1.8"
				stroke="currentColor"
				class="size-4 shrink-0 text-gray-500 transition group-hover:text-gray-700 dark:text-gray-400 dark:group-hover:text-gray-200"
			>
				<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
			</svg>
		</button>

		<Modal bind:show={showDialog} size={$mobile ? 'full' : 'lg'}>
			<div class="flex max-h-[85vh] flex-col dark:text-gray-300">
				<div class="flex items-center justify-between px-5 pt-4 pb-3">
					<div>
						<div class="text-lg font-medium">{$i18n.t('Select a model')}</div>
						<div class="text-sm text-gray-500 dark:text-gray-400">
							{$i18n.t('Choose models for this chat')}
						</div>
					</div>
					<button
						class="self-center"
						aria-label={$i18n.t('Close')}
						on:click={() => {
							showDialog = false;
						}}
					>
						<XMark className={'size-5'} />
					</button>
				</div>

				<div class="overflow-y-auto px-4 pb-5 sm:px-5">
					<div class="flex flex-col w-full items-start gap-3">
						{#each selectedModels as selectedModel, selectedModelIdx}
							<div class="flex w-full items-start gap-2">
								<div
									class="overflow-hidden w-full rounded-2xl border border-gray-200 bg-gray-50/70 px-1.5 py-1.5 dark:border-gray-800 dark:bg-gray-850/70"
								>
									<Selector
										id={`${selectedModelIdx}`}
										buttonId={`model-selector-${selectedModelIdx}-dialog-button`}
										placeholder={$i18n.t('Select a model')}
										items={$models.map((model) => ({
											value: model.id,
											label: model.name,
											model: model
										}))}
										{pinModelHandler}
										triggerClassName="text-base"
										className="w-[38rem]"
										bind:value={selectedModel}
										on:select={() => {
											if (!$mobile) {
												showDialog = false;
											}
										}}
									/>
								</div>

								{#if $user?.role === 'admin' || ($user?.permissions?.chat?.multiple_models ?? true)}
									{#if selectedModelIdx === 0}
										<div
											class="self-center mx-1 disabled:text-gray-600 disabled:hover:text-gray-600 -translate-y-[0.5px]"
										>
											<Tooltip content={$i18n.t('Add Model')}>
												<button
													class=""
													{disabled}
													on:click={() => {
														selectedModels = [...selectedModels, ''];
													}}
													aria-label="Add Model"
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														fill="none"
														viewBox="0 0 24 24"
														stroke-width="2"
														stroke="currentColor"
														class="size-3.5"
													>
														<path
															stroke-linecap="round"
															stroke-linejoin="round"
															d="M12 6v12m6-6H6"
														/>
													</svg>
												</button>
											</Tooltip>
										</div>
									{:else}
										<div
											class="self-center mx-1 disabled:text-gray-600 disabled:hover:text-gray-600 -translate-y-[0.5px]"
										>
											<Tooltip content={$i18n.t('Remove Model')}>
												<button
													{disabled}
													on:click={() => {
														selectedModels.splice(selectedModelIdx, 1);
														selectedModels = selectedModels;
													}}
													aria-label="Remove Model"
												>
													<svg
														xmlns="http://www.w3.org/2000/svg"
														fill="none"
														viewBox="0 0 24 24"
														stroke-width="2"
														stroke="currentColor"
														class="size-3"
													>
														<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15" />
													</svg>
												</button>
											</Tooltip>
										</div>
									{/if}
								{/if}
							</div>
						{/each}

						<div class="flex items-center gap-3 px-1 pt-1">
							{#if showSetDefault}
								<button
									class="relative text-left text-[0.75rem] text-gray-600 dark:text-gray-400 font-primary"
									on:click={saveDefaultModel}
								>
									{$i18n.t('Set as default')}
								</button>
							{/if}

							<button
								class="text-[0.75rem] text-gray-600 dark:text-gray-400"
								id="open-settings-button"
								on:click={async () => {
									await showSettings.set('interface');
								}}
							>
								{$i18n.t('Open settings')}
							</button>
						</div>
					</div>
				</div>
			</div>
		</Modal>
	{:else}
		<div class="flex flex-col w-full items-start">
			{#each selectedModels as selectedModel, selectedModelIdx}
				<div class="flex w-full max-w-fit">
					<div class="overflow-hidden w-full">
						<div class="max-w-full {($settings?.highContrastMode ?? false) ? 'm-1' : 'mr-1'}">
							<Selector
								id={`${selectedModelIdx}`}
								placeholder={$i18n.t('Select a model')}
								items={$models.map((model) => ({
									value: model.id,
									label: model.name,
									model: model
								}))}
								{pinModelHandler}
								bind:value={selectedModel}
							/>
						</div>
					</div>

					{#if $user?.role === 'admin' || ($user?.permissions?.chat?.multiple_models ?? true)}
						{#if selectedModelIdx === 0}
							<div
								class="  self-center mx-1 disabled:text-gray-600 disabled:hover:text-gray-600 -translate-y-[0.5px]"
							>
								<Tooltip content={$i18n.t('Add Model')}>
									<button
										class=" "
										{disabled}
										on:click={() => {
											selectedModels = [...selectedModels, ''];
										}}
										aria-label="Add Model"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
											stroke-width="2"
											stroke="currentColor"
											class="size-3.5"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M12 6v12m6-6H6" />
										</svg>
									</button>
								</Tooltip>
							</div>
						{:else}
							<div
								class="  self-center mx-1 disabled:text-gray-600 disabled:hover:text-gray-600 -translate-y-[0.5px]"
							>
								<Tooltip content={$i18n.t('Remove Model')}>
									<button
										{disabled}
										on:click={() => {
											selectedModels.splice(selectedModelIdx, 1);
											selectedModels = selectedModels;
										}}
										aria-label="Remove Model"
									>
										<svg
											xmlns="http://www.w3.org/2000/svg"
											fill="none"
											viewBox="0 0 24 24"
											stroke-width="2"
											stroke="currentColor"
											class="size-3"
										>
											<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15" />
										</svg>
									</button>
								</Tooltip>
							</div>
						{/if}
					{/if}
				</div>
			{/each}
		</div>

		{#if showSetDefault}
			<div
				class="relative text-left mt-[1px] ml-1 text-[0.7rem] text-gray-600 dark:text-gray-400 font-primary"
			>
				<button on:click={saveDefaultModel}> {$i18n.t('Set as default')}</button>
			</div>
		{/if}
	{/if}
</div>
