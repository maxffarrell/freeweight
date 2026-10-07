import type { auth } from '#lib/server/auth.ts';

type AuthSession = typeof auth.$Infer.Session;

declare global {
	namespace App {
		interface Locals {
			user?: AuthSession['user'];
			session?: AuthSession['session'];
		}
	}
}

export {};
