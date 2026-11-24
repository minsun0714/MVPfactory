import type { PrismaClient } from "@prisma/client";
import type { WorkflowStore } from "@/application/workflow-ports";
import { createWorkflowJobStore } from "@/infrastructure/prisma/workflow-job-store";
import { createWorkflowRunStore } from "@/infrastructure/prisma/workflow-run-store";
import { createWorkflowArtifactStore } from "@/infrastructure/prisma/workflow-artifact-store";
import { createWorkflowDecisionStore } from "@/infrastructure/prisma/workflow-decision-store";
import { createWorkflowMeetingStore } from "@/infrastructure/prisma/workflow-meeting-store";

export function createWorkflowStore(db: PrismaClient): WorkflowStore {
  return {
    ...createWorkflowJobStore(db),
    ...createWorkflowRunStore(db),
    ...createWorkflowArtifactStore(db),
    ...createWorkflowDecisionStore(db),
    ...createWorkflowMeetingStore(db),
  };
}
