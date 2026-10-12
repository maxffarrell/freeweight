import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$app/env/private', () => env);

beforeEach(() => {
	vi.resetModules();
	Object.assign(env, {
		FREEWEIGHT_AI_KEY: undefined,
		FREEWEIGHT_AI_MODEL: 'test-model',
		FREEWEIGHT_AI_BASE_URL: undefined,
		FREEWEIGHT_AI_DECISION_KEY: undefined,
		FREEWEIGHT_AI_DECISION_MODEL: undefined,
		FREEWEIGHT_AI_DECISION_BASE_URL: undefined,
		FREEWEIGHT_AI_PROVIDER: undefined
	});
});
afterEach(() => vi.unstubAllGlobals());

describe('BYOK AI without a Cloud flag or enterprise key', () => {
	it('keeps an unconfigured provider unavailable', async () => {
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(false);
		expect(ai.aiDecisionAvailable()).toBe(false);
	});

	it('uses a supplied provider key without any license entitlement', async () => {
		env.FREEWEIGHT_AI_KEY = 'provider-key';
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ choices: [{ message: { content: 'draft' } }] }));
		vi.stubGlobal('fetch', fetchMock);
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(true);
		expect(ai.aiDecisionAvailable()).toBe(true);
		expect(await ai.aiComplete([{ role: 'user', content: 'hello' }])).toBe('draft');
		expect(fetchMock.mock.calls[0][1].headers.authorization).toBe('Bearer provider-key');
	});

	it('supports an explicit keyless local endpoint without sending a bearer token', async () => {
		env.FREEWEIGHT_AI_BASE_URL = 'http://localhost:11434';
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ choices: [{ message: { content: 'local draft' } }] }));
		vi.stubGlobal('fetch', fetchMock);
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(true);
		expect(await ai.aiComplete([{ role: 'user', content: 'hello' }])).toBe('local draft');
		expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:11434/v1/chat/completions');
		expect(fetchMock.mock.calls[0][1].headers).not.toHaveProperty('authorization');
	});

	it('can configure structured calls separately from freeform features', async () => {
		env.FREEWEIGHT_AI_DECISION_BASE_URL = 'http://localhost:11434';
		env.FREEWEIGHT_AI_DECISION_MODEL = 'decision-model';
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(false);
		expect(ai.aiDecisionAvailable()).toBe(true);
	});

	it('requires an Anthropic key and an explicit OpenAI-compatible decision endpoint', async () => {
		env.FREEWEIGHT_AI_PROVIDER = 'anthropic';
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(false);
		env.FREEWEIGHT_AI_KEY = 'anthropic-key';
		expect(ai.aiAvailable()).toBe(true);
		expect(ai.aiDecisionAvailable()).toBe(false);
		env.FREEWEIGHT_AI_DECISION_BASE_URL = 'http://localhost:11434';
		expect(ai.aiDecisionAvailable()).toBe(true);
	});

	it('reports missing provider configuration instead of requiring a license', async () => {
		const ai = await import('./ai.ts');
		for (const [requireProvider, message] of [
			[ai.requireAi, 'No AI provider configured'],
			[ai.requireAiDecision, 'No AI decision model configured']
		] as const) {
			let caught: unknown;
			try {
				requireProvider();
			} catch (error) {
				caught = error;
			}
			expect(caught).toMatchObject({
				status: 400,
				body: { message: expect.stringContaining(message) }
			});
		}
	});
});
