import { describe, expect, it, vi } from 'vitest';
const env = vi.hoisted(() => ({ FREEWEIGHT_DEMO: false }));
const select = vi.hoisted(() => vi.fn());
vi.mock('$app/env/private', () => env);
vi.mock('./db/index.ts', () => ({ db: { select } }));
vi.mock('./auth.ts', () => ({ auth: {} }));
vi.mock('./services/demo.ts', () => ({ loadDemoData: vi.fn() }));
import { purgeExpiredDemos } from './demo-mode.ts';

describe('demo cleanup deployment boundary', () => {
	it('production cron cannot query or delete even demo-suffix accounts', async () => {
		await purgeExpiredDemos();
		expect(select).not.toHaveBeenCalled();
	});
});
