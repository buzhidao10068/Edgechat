import { nextDailyUtcHour } from '../utils.js';
import { runScheduledGc } from '../gc.js';

// 19:00 UTC = 北京时间每天 03:00，沿用改用 alarm 之前 Cron 选定的低峰时段。
const GC_UTC_HOUR = 19;

export class Scheduler {
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }

  async fetch() {
    const currentAlarm = await this.state.storage.getAlarm();
    if (!currentAlarm) {
      await this.state.storage.setAlarm(nextDailyUtcHour(GC_UTC_HOUR));
    }

    return new Response('ok');
  }

  async alarm() {
    // 重排放在 finally：GC 抛错时闹钟链必须续上，否则垃圾回收会永久停摆且没有 Cron 兜底。
    try {
      await runScheduledGc(this.env);
    } finally {
      await this.state.storage.setAlarm(nextDailyUtcHour(GC_UTC_HOUR));
    }
  }
}
