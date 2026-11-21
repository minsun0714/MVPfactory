import { createProjectUseCases } from "@/application/projects";
import { projectRepository } from "@/infrastructure/project-repository";
import { DEV_USER_ID } from "@/lib/db";

export const projects = createProjectUseCases(projectRepository, DEV_USER_ID);
