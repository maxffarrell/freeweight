import { query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import { atRiskMembers, getReports } from '#lib/server/services/reports.ts';

export const getReportsQuery = query(async () => getReports((await requireOrg()).orgId));

/** Light at-risk list for the dashboard churn card (same source as Reports). */
export const getAtRisk = query(async () => atRiskMembers((await requireOrg()).orgId));
