import type { WorkerContribution } from "../types";
import { adflowQueue } from "@/modules/ad-accounts/worker/queue";
import { processAdflowJob } from "@/server/adflow/processor";
export function getAdflowWorkerContributions(): WorkerContribution[] {
  return [
    {
      id: "adflow.process",
      queue: adflowQueue,
      processor: processAdflowJob,
      options: { concurrency: 2, lockDuration: 15 * 60000 },
      scheduler: {
        id: "adflow-outbox",
        queue: adflowQueue,
        register: async () => {
          await adflowQueue.upsertJobScheduler(
            "adflow-outbox",
            { every: 15000 },
            { name: "dispatch", data: { kind: "dispatch", id: "" } },
          );
        },
        remove: async () => {
          await adflowQueue.removeJobScheduler("adflow-outbox");
        },
      },
    },
  ];
}
