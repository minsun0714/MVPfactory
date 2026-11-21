import type { CompanyRepository } from "@/application/ports";
import { CATALOG } from "@/domain/company-catalog";
import {
  parseRole,
  parseUpdateCharacter,
  parseUpdateOffice,
} from "@/domain/company";

export function createCompanyUseCases(company: CompanyRepository) {
  return {
    get: () => company.get(),
    catalog: () => CATALOG,
    updateCharacter(role: string, body: unknown) {
      const parsedRole = parseRole(role);
      const { version, appearance } = parseUpdateCharacter(body);
      return company.updateCharacter(parsedRole, version, appearance);
    },
    updateOffice(body: unknown) {
      const { version, layout } = parseUpdateOffice(body);
      return company.updateOffice(version, layout);
    },
  };
}
