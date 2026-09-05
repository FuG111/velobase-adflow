import type { FrameworkModule } from "./registry";
import { requestDiagnosis } from "@/modules/ad-diagnostics/server/service";
import { createLogger } from "@/lib/logger";
const log = createLogger("adflow");
export const adflowModule: FrameworkModule = {
  name: "adflow",
  enabled: true,
  registerEventHandlers(bus) {
    bus.on("ads:sync-completed", async ({ userId, accountId }) => {
      await requestDiagnosis(userId, accountId).catch(() =>
        log.info(
          { accountId },
          "Diagnosis awaits configuration or entitlement",
        ),
      );
    });
  },
};
