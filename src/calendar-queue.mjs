import { Queue, Worker } from "bullmq";

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

export async function createCalendarQueue({ redisUrl, processAssignment }) {
  const fallback = {
    enabled: false,
    async enqueue(assignmentId) {
      return processAssignment(assignmentId);
    },
    async close() {}
  };
  if (!redisUrl) {
    return fallback;
  }

  const connection = redisConnection(redisUrl);
  const queue = new Queue("signage-calendar-sync", { connection });
  let available = true;
  const worker = new Worker(
    "signage-calendar-sync",
    job => processAssignment(job.data.assignmentId),
    { connection, concurrency: 3 }
  );
  worker.on("failed", (job, error) => {
    console.error(`Calendar queue job ${job?.id || "unknown"} failed:`, error.message);
  });
  queue.on("error", () => {
    available = false;
  });
  worker.on("error", () => {
    available = false;
  });
  try {
    await Promise.race([
      Promise.all([queue.waitUntilReady(), worker.waitUntilReady()]),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Redis connection timed out.")), 7000))
    ]);
  } catch (error) {
    worker.disconnect();
    queue.disconnect();
    console.warn(`Redis calendar queue unavailable; using in-process polling: ${error.message}`);
    return fallback;
  }

  return {
    get enabled() {
      return available;
    },
    async enqueue(assignmentId, reason = "scheduled") {
      const bucket = Math.floor(Date.now() / 30_000);
      try {
        const job = await queue.add(
          "sync-assignment",
          { assignmentId, reason },
          {
            jobId: `${assignmentId}-${bucket}`,
            attempts: 4,
            backoff: { type: "exponential", delay: 5000 },
            removeOnComplete: 100,
            removeOnFail: 200
          }
        );
        available = true;
        return job;
      } catch (error) {
        available = false;
        console.warn(`Calendar queue enqueue failed; running ${assignmentId} in-process: ${error.message}`);
        return processAssignment(assignmentId);
      }
    },
    async close() {
      await worker.close();
      await queue.close();
    }
  };
}
