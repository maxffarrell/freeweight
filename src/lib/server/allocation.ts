export type OpenCharge = { id: string; open: number };

/** Splits `amount` across open charges oldest-first; anything left over is unapplied credit. */
export function allocate(amount: number, charges: OpenCharge[]) {
	const parts: { chargeId: string | null; amount: number }[] = [];
	let left = amount;
	for (const c of charges) {
		if (left <= 0) break;
		if (c.open <= 0) continue;
		const take = Math.min(c.open, left);
		parts.push({ chargeId: c.id, amount: take });
		left -= take;
	}
	if (left > 0) parts.push({ chargeId: null, amount: left });
	return parts;
}
