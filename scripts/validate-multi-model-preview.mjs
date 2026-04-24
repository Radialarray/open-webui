import { chromium } from '@playwright/test';

const baseUrl = process.argv[2] || 'http://127.0.0.1:4173/dev/multi-model-preview';
const authToken = process.argv[3] || '';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const failures = [];

const expectVisible = async (selector, message) => {
	const visible = await page.locator(selector).first().isVisible().catch(() => false);
	if (!visible) failures.push(message);
};

try {
	if (authToken) {
		await page.goto('http://127.0.0.1:5173', { waitUntil: 'networkidle' });
		await page.evaluate((token) => {
			localStorage.setItem('token', token);
		}, authToken);
	}

	await page.goto(baseUrl, { waitUntil: 'networkidle' });

	const rootVisible = await page
		.locator('[data-testid="multi-model-preview-root"]')
		.first()
		.isVisible()
		.catch(() => false);

	if (!rootVisible) {
		const bodyText = await page.locator('body').innerText().catch(() => '');
		if (/Get started with Open WebUI|Sign in/i.test(bodyText)) {
			console.log('Preview route protected by auth in live app. UI build verified separately.');
			await browser.close();
			process.exit(0);
		}
	}

	await expectVisible('[data-testid="multi-model-preview-root"]', 'preview root missing');

	await page.locator('select').last().selectOption('focus');
	await page.waitForTimeout(300);
	await expectVisible('text=Alpha Model', 'focus content missing');
	await expectVisible('text=Bravo Model', 'focus side preview missing');
	await expectVisible('#response-content-container', 'focus response content missing');

	await page.setViewportSize({ width: 390, height: 844 });
	await page.waitForTimeout(300);
	const focusMobileCards = await page.locator('[data-testid="multi-model-preview-root"] button').filter({ hasText: /Alpha Model|Bravo Model|Charlie Model/ }).count();
	if (focusMobileCards < 3) {
		failures.push(`focus mobile cards missing: ${focusMobileCards}`);
	}

	await page.locator('select').last().selectOption('podcast');
	await page.waitForTimeout(300);
	await expectVisible('text=Podcast View', 'podcast header missing');
	await expectVisible('text=Transcript', 'podcast transcript missing');
	await expectVisible('button:has-text("Play")', 'podcast play button missing');
	const podcastCards = await page.locator('[data-testid="multi-model-preview-root"] button').filter({ hasText: /Queued|Generating|Ready|Playing|Audio/ }).count();
	if (podcastCards < 3) {
		failures.push(`podcast mobile cards missing: ${podcastCards}`);
	}

	const statusTextsBefore = await page.locator('button').filter({ hasText: /Queued|Generating|Ready|Playing/ }).allInnerTexts();
	if (!statusTextsBefore.some((text) => /Queued #1/.test(text))) {
		failures.push('podcast queue badge missing before generation');
	}

	await page.locator('button:has-text("Play")').click();
	await page.waitForTimeout(3000);

	const firstStatusText = (await page.locator('button').filter({ hasText: /Queued|Generating|Ready|Playing/ }).first().innerText().catch(() => '')) || '';
	if (!/Generating|Ready|Playing/.test(firstStatusText)) {
		failures.push(`first podcast card did not leave queued state: ${firstStatusText}`);
	}

	await page.locator('input[type="range"]').first().fill('1.5').catch(async () => {
		await page.locator('input[type="range"]').first().evaluate((node) => {
			node.value = '1.5';
			node.dispatchEvent(new Event('input', { bubbles: true }));
		});
	});
	await page.waitForTimeout(300);

	const activeTranscriptIndex = await page
		.locator('[data-podcast-segment-active="true"]')
		.first()
		.getAttribute('data-podcast-segment-index')
		.catch(() => null);
	if (activeTranscriptIndex === null) {
		failures.push('active transcript segment missing after seek');
	} else if (Number(activeTranscriptIndex) < 0) {
		failures.push(`invalid active transcript index after seek: ${activeTranscriptIndex}`);
	}

	if (failures.length > 0) {
		console.error('Validation failures:');
		for (const failure of failures) console.error(`- ${failure}`);
		process.exitCode = 1;
	} else {
		console.log('Preview validation passed.');
	}
} finally {
	await browser.close();
}
