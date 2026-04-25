import { getMessageContentParts } from '$lib/utils';

type BuildPodcastAssetCacheKeyParams = {
	engine?: string;
	voice?: string;
	text?: string;
};

export type PodcastSegment = {
	text: string;
	index: number;
	start: number;
	end: number;
};

export const buildPodcastSegments = (content: string, splitOn: string = 'punctuation') => {
	const parts = getMessageContentParts(content, splitOn).filter((part) => part.trim().length > 0);

	if (parts.length === 0) return [] as PodcastSegment[];

	const totalChars = parts.reduce((sum, part) => sum + part.length, 0) || 1;
	const estimatedDuration = Math.max(6, Math.ceil(totalChars / 14));

	let cursor = 0;
	return parts.map((text, index) => {
		const slice = Math.max(1.5, (text.length / totalChars) * estimatedDuration);
		const segment = {
			text,
			index,
			start: cursor,
			end: cursor + slice
		};
		cursor += slice;
		return segment;
	});
};

export const scalePodcastSegmentsToDuration = (segments: PodcastSegment[], duration: number) => {
	if (!segments.length || !Number.isFinite(duration) || duration <= 0) {
		return segments;
	}

	const total = segments.at(-1)?.end ?? 0;
	if (!total || !Number.isFinite(total)) {
		return segments;
	}

	const scale = duration / total;

	return segments.map((segment) => ({
		...segment,
		start: segment.start * scale,
		end: segment.end * scale
	}));
};

export const buildFallbackWaveformBars = (seed: string, length: number = 64) => {
	const source = seed || 'waveform';
	return Array.from({ length }, (_, idx) => {
		const charCode = source.charCodeAt(idx % source.length) || 0;
		return 18 + ((charCode + idx * 17) % 56);
	});
};

export const extractWaveformBarsFromBlob = async (blob: Blob, samples: number = 64) => {
	const arrayBuffer = await blob.arrayBuffer();
	const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;

	if (!AudioContextCtor) {
		return {
			bars: buildFallbackWaveformBars(`blob-${blob.size}`, samples),
			duration: 0
		};
	}

	const audioContext = new AudioContextCtor();
	try {
		const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
		const channelData = audioBuffer.getChannelData(0);
		const blockSize = Math.max(1, Math.floor(channelData.length / samples));

		const bars = Array.from({ length: samples }, (_, idx) => {
			const start = idx * blockSize;
			const end = Math.min(channelData.length, start + blockSize);
			let peak = 0;

			for (let i = start; i < end; i++) {
				peak = Math.max(peak, Math.abs(channelData[i]));
			}

			return Math.max(10, Math.round(peak * 100));
		});

		return {
			bars,
			duration: audioBuffer.duration
		};
	} finally {
		await audioContext.close().catch(() => {});
	}
};

export const buildPodcastAssetCacheKey = ({
	engine = '',
	voice = '',
	text = ''
}: BuildPodcastAssetCacheKeyParams) => {
	return JSON.stringify({
		engine,
		voice,
		text
	});
};
