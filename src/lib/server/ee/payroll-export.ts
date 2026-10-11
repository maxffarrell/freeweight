/* @license Enterprise */

import { error } from '@sveltejs/kit';
import { gte, and, asc, desc, eq, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { member, session, user } from '#lib/server/db/auth.schema.ts';
import { classSession, classType, shift } from '#lib/server/db/schema.ts';
import { hasFeature } from './license.ts';

export function payrollExportEnabled() {
	return hasFeature('payroll-export');
}

export function requirePayrollExport() {
	if (!payrollExportEnabled()) throw error(403, 'Payroll export is an Enterprise feature');
}

/**
 * Payroll-provider-style pay run for the current month: instructor per-class
 * pay plus front-desk clocked hours at their hourly rate.
 */
export async function exportPayroll(orgId: string, from?: string, to?: string) {
	const start = new Date(from ?? `${new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
	const end = to ? new Date(`${to}T00:00:00Z`) : new Date();
	const [classRows, shiftRows] = await Promise.all([
		db
			.select({
				memberId: member.id,
				name: user.name,
				email: user.email,
				classes: sql<number>`count(*)`.mapWith(Number),
				pay: sql<number>`coalesce(sum(${classType.payRate}), 0)`.mapWith(Number)
			})
			.from(classSession)
			.innerJoin(member, eq(classSession.instructorId, member.id))
			.innerJoin(user, eq(member.userId, user.id))
			.innerJoin(classType, eq(classSession.classTypeId, classType.id))
			.where(
				and(
					eq(classSession.organizationId, orgId),
					gte(classSession.startsAt, start),
					lt(classSession.startsAt, end),
					isNull(classSession.cancelledAt),
					isNotNull(classType.payRate)
				)
			)
			.groupBy(member.id, user.name, user.email)
			.orderBy(asc(user.name)),
		db
			.select({
				memberId: member.id,
				name: user.name,
				email: user.email,
				hourlyRateCents: member.hourlyRateCents,
				minutes:
					sql<number>`coalesce(sum(extract(epoch from (${shift.clockedOutAt} - ${shift.clockedInAt})) / 60), 0)`.mapWith(
						Number
					)
			})
			.from(shift)
			.innerJoin(member, eq(shift.memberId, member.id))
			.innerJoin(user, eq(member.userId, user.id))
			.where(
				and(
					eq(shift.organizationId, orgId),
					gte(shift.clockedInAt, start),
					lt(shift.clockedInAt, end),
					isNotNull(shift.clockedOutAt)
				)
			)
			.groupBy(member.id, user.name, user.email, member.hourlyRateCents)
			.orderBy(asc(user.name))
	]);
	const byMember = new Map<
		string,
		{
			employee: string;
			email: string;
			classes: number;
			classPay: number;
			hours: number;
			hourlyPay: number;
		}
	>();
	for (const r of classRows)
		byMember.set(r.memberId, {
			employee: r.name,
			email: r.email,
			classes: r.classes,
			classPay: r.pay,
			hours: 0,
			hourlyPay: 0
		});
	for (const r of shiftRows) {
		const hours = r.minutes / 60;
		const row = byMember.get(r.memberId) ?? {
			employee: r.name,
			email: r.email,
			classes: 0,
			classPay: 0,
			hours: 0,
			hourlyPay: 0
		};
		row.hours = Math.round(hours * 100) / 100;
		row.hourlyPay = Math.round(hours * (r.hourlyRateCents ?? 0));
		byMember.set(r.memberId, row);
	}
	const rows = [...byMember.values()].map((r) => ({ ...r, gross: r.classPay + r.hourlyPay }));
	return {
		month: from
			? `${from.slice(0, 10)}_to_${(to ?? new Date().toISOString()).slice(0, 10)}`
			: new Date().toISOString().slice(0, 7),
		rows,
		total: rows.reduce((a, r) => a + r.gross, 0)
	};
}

/** Staff sign-in access log — newest sessions first, for the audit view. */
export async function listAccessLog(orgId: string, limit = 50) {
	return db
		.select({
			name: user.name,
			email: user.email,
			signedInAt: session.createdAt,
			ipAddress: session.ipAddress,
			userAgent: session.userAgent
		})
		.from(session)
		.innerJoin(member, eq(session.userId, member.userId))
		.innerJoin(user, eq(member.userId, user.id))
		.where(eq(member.organizationId, orgId))
		.orderBy(desc(session.createdAt))
		.limit(limit);
}
