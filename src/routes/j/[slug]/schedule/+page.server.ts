import type { PageServerLoad } from './$types';
import { getPublicGym } from '#lib/server/services/public.ts';

export const load: PageServerLoad = ({ params }) => getPublicGym(params.slug);
