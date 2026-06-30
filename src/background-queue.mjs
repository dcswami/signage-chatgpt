import { Queue, QueueEvents, Worker } from "bullmq";

function redisConnection(redisUrl) {
  const url = new URL(redisUrl);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    username: decodeURIComponent(url.username || ""),
    password: decodeURIComponent(url.password || ""),
    db: Number(url.pathname.slice(1) || 0),
    connectTimeout: 5000,
    enableOfflineQueue: false,
    maxRetriesPerRequest: null,
    retryStrategy(times) {
      return times > 3 ? null : Math.min(times * 250, 1000);
    }
  };
}

export async function createBackgroundQueue({ redisUrl, handlers, onDistributedEvent }) {
  const local = {
    enabled: false,
    async enqueue(name, data = {}, options = {}) {
      const handler = handlers[name];
      if (!handler) throw new Error(`Unknown background job: ${name}`);
      const result = await handler(data, options);
      if (result?.distributedEvent) onDistributedEvent(result.distributedEvent);
      return result;
    },
    async distribute(event) {
      return onDistributedEvent(event);
    },
    async close() {}
  };
  if (!redisUrl) return local;

  const connection = redisConnection(redisUrl);
  const queueName = "signage-background";
  const queue = new Queue(queueName, { connection });
  const events = new QueueEvents(queueName, { connection });
  const worker = new Worker(queueName, async job => {
    if (job.name === "distributed-event") return { distributedEvent: job.data };
    const handler = handlers[job.name];
    if (!handler) throw new Error(`Unknown background job: ${job.name}`);
    return handler(job.data, { jobId: job.id });
  }, { connection, concurrency: Number(process.env.BACKGROUND_WORKER_CONCURRENCY || 5) });
  let available = true;

  worker.on("failed", (job, error) => {
    console.error(`Background job ${job?.name || "unknown"} failed:`, error.message);
  });
  for (const emitter of [queue, events, worker]) emitter.on("error", () => { available = false; });
  events.on("completed", ({ returnvalue }) => {
    try {
      const parsed = typeof returnvalue === "string" ? JSON.parse(returnvalue) : returnvalue;
      if (parsed?.distributedEvent) Promise.resolve(onDistributedEvent(parsed.distributedEvent)).catch(() => {});
    } catch {
      // Ignore non-distribution job results.
    }
  });

  try {
    await Promise.race([
      Promise.all([queue.waitUntilReady(), events.waitUntilReady(), worker.waitUntilReady()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connection timed out.")), 7000))
    ]);
  } catch (error) {
    queue.disconnect();
    events.disconnect();
    worker.disconnect();
    console.warn(`Redis background queue unavailable; using in-process jobs: ${error.message}`);
    return local;
  }

  return {
    get enabled() {
      return available;
    },
    async enqueue(name, data = {}, options = {}) {
      try {
        const job = await queue.add(name, data, {
          jobId: options.jobId,
          attempts: options.attempts || 3,
          backoff: { type: "exponential", delay: options.delay || 2000 },
          removeOnComplete: 250,
          removeOnFail: 500
        });
        available = true;
        return job;
      } catch (error) {
        available = false;
        return local.enqueue(name, data, options);
      }
    },
    async distribute(event) {
      const bucket = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return this.enqueue("distributed-event", event, { jobId: `event-${bucket}`, attempts: 1 });
    },
    async close() {
      await Promise.all([worker.close(), events.close(), queue.close()]);
    }
  };
}
