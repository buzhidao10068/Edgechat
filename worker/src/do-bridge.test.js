import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureSchedulerArmed } from './do-bridge.js';

function createSchedulerEnv(onFetch) {
	return {
		SCHEDULER: {
			idFromName(name) {
				return { name };
			},
			get() {
				return { fetch: onFetch };
			}
		}
	};
}

// 上弦标记是模块级状态（每个 isolate 一份），所以这些断言必须串在同一个用例里按顺序验证。
test('上弦请求跳过缺失绑定、失败可重试、成功后每个 isolate 只发一次', async (t) => {
	// 用例里会故意让上弦失败，屏蔽掉预期内的错误日志，避免污染 CI 输出。
	t.mock.method(console, 'error', () => {});

	const pending = [];
	const ctx = {
		waitUntil(promise) {
			pending.push(promise);
		}
	};

	ensureSchedulerArmed({}, ctx);
	assert.equal(pending.length, 0, '没有 SCHEDULER 绑定时不应发起请求');

	let fetchCalls = 0;
	const env = createSchedulerEnv(async () => {
		fetchCalls += 1;
		if (fetchCalls === 1) {
			throw new Error('durable object unreachable');
		}
		return new Response('ok');
	});

	ensureSchedulerArmed(env, ctx);
	await Promise.all(pending);
	assert.equal(fetchCalls, 1);

	ensureSchedulerArmed(env, ctx);
	await Promise.all(pending);
	assert.equal(fetchCalls, 2, '前一次失败后应当允许重试');

	ensureSchedulerArmed(env, ctx);
	await Promise.all(pending);
	assert.equal(fetchCalls, 2, '成功之后同一个 isolate 内不应重复上弦');
});
