import {
	createInternalHeaders,
	createVerifiedPrincipalHeaders,
} from "./verified-identity.js";

const INTERNAL_ORIGIN = "https://cfchat.internal";

function getChannelRoomStub(env, kind, roomId) {
	const name = `${kind}:${Number(roomId)}`;
	return env.CHANNEL_ROOM.get(env.CHANNEL_ROOM.idFromName(name));
}

function getUserInboxStub(env, userId) {
	const name = `user:${Number(userId)}`;
	return env.USER_INBOX.get(env.USER_INBOX.idFromName(name));
}

const SCHEDULER_SINGLETON_NAME = "gc";

// 每个 isolate 只探一次；Scheduler 自己会判断闹钟是否已存在，重复探测不会改动既有排期。
let schedulerArmRequested = false;

function getSchedulerStub(env) {
	return env.SCHEDULER.get(env.SCHEDULER.idFromName(SCHEDULER_SINGLETON_NAME));
}

export function ensureSchedulerArmed(env, ctx) {
	if (schedulerArmRequested || !env?.SCHEDULER) {
		return;
	}

	schedulerArmRequested = true;
	ctx.waitUntil(
		getSchedulerStub(env)
			.fetch(`${INTERNAL_ORIGIN}/arm`, { headers: createInternalHeaders() })
			.catch((error) => {
				// 失败就放开标记交给下一个请求重试，否则这个 isolate 再也不会尝试上弦。
				schedulerArmRequested = false;
				console.error("arm gc scheduler failed", error);
			}),
	);
}

export async function forwardVerifiedRequest({
	stub,
	request,
	pathname,
	searchParams = {},
	principal,
}) {
	const url = new URL(request.url);
	url.pathname = pathname;
	for (const [key, value] of Object.entries(searchParams)) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}

	const init = {
		method: request.method,
		headers: createVerifiedPrincipalHeaders(request.headers, principal),
	};
	if (!["GET", "HEAD"].includes(request.method)) {
		// 先把请求体固化为可重放字节，避免跨运行时转发 ReadableStream 时依赖 Node 专属 duplex 配置。
		init.body = await request.arrayBuffer();
	}
	return stub.fetch(new Request(url.toString(), init));
}

export function forwardRoomConnection({ env, request, kind, roomId, principal }) {
	return forwardVerifiedRequest({
		stub: getChannelRoomStub(env, kind, roomId),
		request,
		pathname: "/connect",
		searchParams: { kind, id: roomId, token: principal.token },
		principal,
	});
}

export function forwardInboxConnection({ env, request, principal }) {
	return forwardVerifiedRequest({
		stub: getUserInboxStub(env, principal.userId),
		request,
		pathname: "/connect",
		principal,
	});
}

export async function notifyUserInbox(env, userId, payload) {
	const response = await getUserInboxStub(env, userId).fetch(`${INTERNAL_ORIGIN}/notify`, {
		method: "POST",
		headers: createInternalHeaders({ "Content-Type": "application/json" }),
		body: JSON.stringify(payload),
	});
	return response;
}

export async function submitExternalRoomMessage(env, payload) {
	const room = payload.room;
	return getChannelRoomStub(env, room.kind, room.id).fetch(
		`${INTERNAL_ORIGIN}/external-message`,
		{
			method: "POST",
			headers: createInternalHeaders({ "Content-Type": "application/json" }),
			body: JSON.stringify(payload),
		},
	);
}
