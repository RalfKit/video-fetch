import { json, error, type RequestHandler } from '@sveltejs/kit';
import { deleteSubscription } from '$lib/server/subscriptions';

export const DELETE: RequestHandler = async ({ params }) => {
	if (!params.id) throw error(400, 'Subscription ID is required');

	await deleteSubscription(params.id);
	return json({ success: true });
};
