import { Queue } from "bullmq";
import { redis } from "@/server/redis";
export type AdsJob = { kind: "dispatch" | "sync" | "diagnose"; id: string };
export const adflowQueue = new Queue<AdsJob>("adflow", {
  connection: redis,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 15000 },
    removeOnComplete: true,
    removeOnFail: { count: 1000 },
  },
});
