/* @license Enterprise */

import { error } from '@sveltejs/kit';
import {
	FREEWEIGHT_AI_PROVIDER,
	FREEWEIGHT_AI_MODEL,
	FREEWEIGHT_AI_KEY,
	FREEWEIGHT_AI_BASE_URL,
	FREEWEIGHT_AI_DECISION_MODEL,
	FREEWEIGHT_AI_DECISION_KEY,
	FREEWEIGHT_AI_DECISION_BASE_URL
} from '$app/env/private';
import * as v from 'valibot';
import { isEnterpriseEnabled } from './license.ts';

export interface AiConfig {
	/** 'openai' (or any OpenAI-compatible endpoint) | 'anthropic'. */
	provider: 'openai' | 'anthropic';
	model: string;
	/** Some providers (e.g. local Ollama) don't need a key. */
	apiKey: string | null;
	baseUrl: string;
}

/**
 * AI features need both an Enterprise license (Freeweight Cloud or a license
 * key) AND a configured model provider. The key never leaves the server —
 * remote functions only expose {licensed, configured} booleans.
 */
export function aiConfig(): AiConfig | null {
	if (!isEnterpriseEnabled()) return null;
	const provider = (FREEWEIGHT_AI_PROVIDER || 'openai').toLowerCase();
	const model =
		FREEWEIGHT_AI_MODEL || (provider === 'anthropic' ? 'claude-sonnet-4-5' : 'gpt-4o-mini');
	const apiKey = FREEWEIGHT_AI_KEY || null;
	if (provider === 'anthropic') {
		return {
			provider: 'anthropic',
			model,
			apiKey,
			baseUrl: FREEWEIGHT_AI_BASE_URL || 'https://api.anthropic.com'
		};
	}
	// Default: OpenAI-compatible chat-completions endpoint (OpenAI, Ollama,
	// OpenRouter, LiteLLM, vLLM — anything that serves POST /v1/chat/completions).
	if (!apiKey) return null;
	return {
		provider: 'openai',
		model,
		apiKey,
		baseUrl: (FREEWEIGHT_AI_BASE_URL || 'https://api.openai.com').replace(/\/$/, '')
	};
}

/**
 * Decision calls — features that return structured JSON the app consumes —
 * run on a separate OpenAI-spec-only config so installs can point them at a
 * cheaper/different model than the freeform feature calls. Each
 * FREEWEIGHT_AI_DECISION_* var falls back to the corresponding FREEWEIGHT_AI_*
 * value, so a single key keeps everything working.
 */
export function aiDecisionConfig(): AiConfig | null {
	if (!isEnterpriseEnabled()) return null;
	const apiKey = FREEWEIGHT_AI_DECISION_KEY || FREEWEIGHT_AI_KEY || null;
	if (!apiKey) return null;
	return {
		provider: 'openai',
		model: FREEWEIGHT_AI_DECISION_MODEL || FREEWEIGHT_AI_MODEL || 'gpt-4o-mini',
		apiKey,
		baseUrl: (
			FREEWEIGHT_AI_DECISION_BASE_URL ||
			FREEWEIGHT_AI_BASE_URL ||
			'https://api.openai.com'
		).replace(/\/$/, '')
	};
}

/** True when a licensed install also has a provider configured. */
export function aiAvailable(): boolean {
	return !!aiConfig();
}

/** True when a licensed install also has a decision model configured. */
export function aiDecisionAvailable(): boolean {
	return !!aiDecisionConfig();
}

/** Gate for AI remote functions: license first, then provider configuration. */
export function requireAi() {
	if (!isEnterpriseEnabled())
		error(403, 'AI features require Freeweight Cloud or an Enterprise license');
	if (!aiAvailable())
		error(400, 'No AI provider configured — set FREEWEIGHT_AI_PROVIDER/_MODEL/_KEY on the server');
}

/** Gate for decision calls: license first, then decision-model configuration. */
export function requireAiDecision() {
	if (!isEnterpriseEnabled())
		error(403, 'AI features require Freeweight Cloud or an Enterprise license');
	if (!aiDecisionAvailable())
		error(
			400,
			'No AI decision model configured — set FREEWEIGHT_AI_DECISION_* (or FREEWEIGHT_AI_*) on the server'
		);
}

export interface AiMessage {
	role: 'system' | 'user' | 'assistant';
	content: string;
}

/** POST /v1/chat/completions against an OpenAI-compatible endpoint. */
async function chatCompletions(
	cfg: AiConfig,
	messages: AiMessage[],
	maxTokens: number
): Promise<string> {
	const res = await fetch(`${cfg.baseUrl}/v1/chat/completions`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			...(cfg.apiKey ? { authorization: `Bearer ${cfg.apiKey}` } : {})
		},
		body: JSON.stringify({ model: cfg.model, max_tokens: maxTokens, messages })
	});
	if (!res.ok) {
		throw new Error(`AI provider returned ${res.status}`);
	}
	const data = (await res.json()) as Record<string, unknown>;
	const choices = data.choices as { message?: { content?: string } }[] | undefined;
	return choices?.[0]?.message?.content?.trim() ?? '';
}

/** One-shot completion — the small primitive every AI feature shares. */
export async function aiComplete(messages: AiMessage[], maxTokens = 1200): Promise<string> {
	const cfg = aiConfig();
	if (!cfg) throw new Error('AI is not configured');
	if (cfg.provider === 'openai') return chatCompletions(cfg, messages, maxTokens);
	const system = messages.find((m) => m.role === 'system')?.content;
	const res = await fetch(`${cfg.baseUrl}/v1/messages`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-api-key': cfg.apiKey ?? '',
			'anthropic-version': '2023-06-01'
		},
		body: JSON.stringify({
			model: cfg.model,
			max_tokens: maxTokens,
			...(system ? { system } : {}),
			messages: messages.filter((m) => m.role !== 'system')
		})
	});
	if (!res.ok) {
		throw new Error(`AI provider returned ${res.status}`);
	}
	const data = (await res.json()) as Record<string, unknown>;
	const content = data.content as { type: string; text?: string }[] | undefined;
	return content?.find((b) => b.type === 'text')?.text?.trim() ?? '';
}

/**
 * Typesafe decision call: asks the decision model for JSON, parses it
 * leniently (strips code fences and surrounding prose that chat models love
 * to add), and validates it against the caller's valibot schema. Returns the
 * validated output or throws when the model's shape doesn't match.
 */
export async function aiDecision<S extends v.GenericSchema>(
	schema: S,
	messages: AiMessage[],
	maxTokens = 1200
): Promise<v.InferOutput<S>> {
	const cfg = aiDecisionConfig();
	if (!cfg) throw new Error('AI decision model is not configured');
	const raw = await chatCompletions(
		cfg,
		[
			{
				role: 'system',
				content: 'Respond with valid JSON only — no prose, no markdown fences.'
			},
			...messages
		],
		maxTokens
	);
	const match = raw.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
	if (!match) throw new Error('AI returned no JSON');
	const parsed = v.safeParse(schema, JSON.parse(match[0]));
	if (!parsed.success) {
		throw new Error(`AI returned invalid JSON: ${v.summarize(parsed.issues)}`);
	}
	return parsed.output;
}
