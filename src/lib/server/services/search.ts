import { and, eq, ilike, or } from 'drizzle-orm';
import { db } from '#lib/server/db/index.ts';
import { classType, gymMember, plan } from '#lib/server/db/schema.ts';

export type SearchHit = {
	kind: 'member' | 'class' | 'plan';
	id: string;
	title: string;
	sub: string;
	href: string;
};

/** Command-palette search across members, class types and plans. */
export async function search(orgId: string, q: string): Promise<SearchHit[]> {
	const term = `%${q.trim()}%`;
	if (term === '%%') return [];
	const [members, classes, plans] = await Promise.all([
		db
			.select({ id: gymMember.id, name: gymMember.name, email: gymMember.email })
			.from(gymMember)
			.where(
				and(
					eq(gymMember.organizationId, orgId),
					or(ilike(gymMember.name, term), ilike(gymMember.email, term))
				)
			)
			.limit(5),
		db
			.select({ id: classType.id, name: classType.name })
			.from(classType)
			.where(and(eq(classType.organizationId, orgId), ilike(classType.name, term)))
			.limit(5),
		db
			.select({ id: plan.id, name: plan.name, amount: plan.amount })
			.from(plan)
			.where(and(eq(plan.organizationId, orgId), ilike(plan.name, term)))
			.limit(5)
	]);
	return [
		...members.map((m) => ({
			kind: 'member' as const,
			id: m.id,
			title: m.name,
			sub: m.email ?? '',
			href: `/members/${m.id}`
		})),
		...classes.map((c) => ({
			kind: 'class' as const,
			id: c.id,
			title: c.name,
			sub: 'Class',
			href: `/schedule?type=${c.id}`
		})),
		...plans.map((p) => ({
			kind: 'plan' as const,
			id: p.id,
			title: p.name,
			sub: 'Membership plan',
			href: `/billing?tab=plans&plan=${p.id}`
		}))
	];
}
export type { SearchHit as Hit };
