import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as v from 'valibot';

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$app/env/private', () => env);

beforeEach(() => {
	vi.resetModules();
	Object.assign(env, {
		FREEWEIGHT_AI_KEY: undefined,
		FREEWEIGHT_AI_MODEL: 'test-model',
		FREEWEIGHT_AI_BASE_URL: undefined,
		FREEWEIGHT_AI_DECISION_PROVIDER: undefined,
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

	it('drives decision calls through Anthropic when the provider is anthropic', async () => {
		env.FREEWEIGHT_AI_PROVIDER = 'anthropic';
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(false);
		expect(ai.aiDecisionAvailable()).toBe(false);
		env.FREEWEIGHT_AI_KEY = 'anthropic-key';
		expect(ai.aiAvailable()).toBe(true);
		expect(ai.aiDecisionAvailable()).toBe(true);
		const fetchMock = vi
			.fn()
			.mockResolvedValue(Response.json({ content: [{ type: 'text', text: '{"ok":true}' }] }));
		vi.stubGlobal('fetch', fetchMock);
		const out = await ai.aiDecision(v.object({ ok: v.boolean() }), [
			{ role: 'user', content: 'hello' }
		]);
		expect(out).toEqual({ ok: true });
		expect(fetchMock.mock.calls[0][0]).toBe('https://api.anthropic.com/v1/messages');
	});

	it('lets decision calls use a different provider than features', async () => {
		env.FREEWEIGHT_AI_PROVIDER = 'anthropic';
		env.FREEWEIGHT_AI_KEY = 'anthropic-key';
		env.FREEWEIGHT_AI_DECISION_PROVIDER = 'openai';
		env.FREEWEIGHT_AI_DECISION_BASE_URL = 'http://localhost:11434';
		const ai = await import('./ai.ts');
		expect(ai.aiAvailable()).toBe(true);
		expect(ai.aiDecisionAvailable()).toBe(true);
		expect(ai.aiDecisionConfig()?.provider).toBe('openai');
		expect(ai.aiDecisionConfig()?.baseUrl).toBe('http://localhost:11434');
		expect(ai.aiDecisionConfig()?.model).toBe('gpt-4o-mini');
		expect(ai.aiDecisionConfig()?.apiKey).toBeNull();
	});

	it.each([
		['openai', 'anthropic', 'https://api.anthropic.com', 'claude-sonnet-4-5'],
		['anthropic', 'openai', 'https://api.openai.com', 'gpt-4o-mini']
	])('isolates decision routing from %s to %s', async (feature, decision, baseUrl, model) => {
		env.FREEWEIGHT_AI_PROVIDER = feature;
		env.FREEWEIGHT_AI_MODEL = 'feature-model';
		env.FREEWEIGHT_AI_KEY = 'feature-key';
		env.FREEWEIGHT_AI_BASE_URL = 'https://feature.example';
		env.FREEWEIGHT_AI_DECISION_PROVIDER = decision;
		env.FREEWEIGHT_AI_DECISION_KEY = 'decision-key';
		const ai = await import('./ai.ts');
		expect(ai.aiDecisionConfig()).toEqual({
			provider: decision,
			baseUrl,
			model,
			apiKey: 'decision-key'
		});
		const fetchMock = vi
			.fn()
			.mockResolvedValue(
				Response.json(
					decision === 'anthropic'
						? { content: [{ type: 'text', text: '{"ok":true}' }] }
						: { choices: [{ message: { content: '{"ok":true}' } }] }
				)
			);
		vi.stubGlobal('fetch', fetchMock);
		expect(
			await ai.aiDecision(v.object({ ok: v.boolean() }), [
				{ role: 'system', content: 'Safety first — sensible volume and progressions.' },
				{ role: 'user', content: 'Design a workout' }
			])
		).toEqual({ ok: true });
		expect(fetchMock.mock.calls[0][0]).toBe(
			baseUrl + (decision === 'anthropic' ? '/v1/messages' : '/v1/chat/completions')
		);
		const body = JSON.parse(fetchMock.mock.calls[0][1].body);
		expect(body.model).toBe(model);
		if (decision === 'anthropic') {
			expect(body.system).toBe(
				'Respond with valid JSON only — no prose, no markdown fences.\n\nSafety first — sensible volume and progressions.'
			);
		}
	});

	it('does not treat a keyless feature endpoint as configured Anthropic decisions', async () => {
		env.FREEWEIGHT_AI_BASE_URL = 'http://localhost:11434';
		env.FREEWEIGHT_AI_DECISION_PROVIDER = 'anthropic';
		const ai = await import('./ai.ts');
		expect(ai.aiDecisionAvailable()).toBe(false);
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
