import assert from 'node:assert/strict';
import test from 'node:test';
import { Scheduler } from './Scheduler.js';

function createState(initialAlarm = null) {
  const state = {
    alarm: initialAlarm,
    setAlarmCalls: 0,
    storage: {
      async getAlarm() {
        return state.alarm;
      },
      async setAlarm(value) {
        state.alarm = value;
        state.setAlarmCalls += 1;
      }
    }
  };

  return state;
}

test('闹钟从未上弦时排到下一个 19:00 UTC', async () => {
  const state = createState();
  const scheduler = new Scheduler(state, {});

  const response = await scheduler.fetch();

  assert.equal(response.status, 200);
  assert.equal(state.setAlarmCalls, 1);
  assert.equal(state.alarm.getUTCHours(), 19);
  assert.equal(state.alarm.getUTCMinutes(), 0);
  assert.ok(state.alarm.getTime() > Date.now());
});

test('闹钟已存在时重复探测不会改动既有排期', async () => {
  const existing = new Date(Date.now() + 60_000);
  const state = createState(existing);
  const scheduler = new Scheduler(state, {});

  await scheduler.fetch();
  await scheduler.fetch();

  assert.equal(state.setAlarmCalls, 0);
  assert.equal(state.alarm, existing);
});

test('GC 抛错时仍然重排下一次闹钟，闹钟链不会断掉', async () => {
  const state = createState();
  // env 缺少 DB 绑定会让 runScheduledGc 抛错，用来验证 finally 里的重排。
  const scheduler = new Scheduler(state, {});

  await assert.rejects(() => scheduler.alarm());

  assert.equal(state.setAlarmCalls, 1);
  assert.equal(state.alarm.getUTCHours(), 19);
});
