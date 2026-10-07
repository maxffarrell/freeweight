import { query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import { getReports } from '#lib/server/services/reports.ts';

export const getReportsQuery = query(async () => getReports((await requireOrg()).orgId));
