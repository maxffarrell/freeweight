import { command, query } from '$app/server';
import { requireOrg } from '#lib/server/context.ts';
import {
	atRiskMembers,
	getReports,
	markPayrollPaid as markPayrollPaidSvc
} from '#lib/server/services/reports.ts';

export const getReportsQuery = query(async () => getReports((await requireOrg()).orgId));

/** Light at-risk list for the dashboard churn card (same source as Reports). */
export const getAtRisk = query(async () => atRiskMembers((await requireOrg()).orgId));

/** Stamp this month's instructor payroll as settled. */
export const markPayrollPaid = command(async () => {
	const ctx = await requireOrg('admin');
	const r = await markPayrollPaidSvc(ctx);
	void getReportsQuery().refresh();
	return r;
});
