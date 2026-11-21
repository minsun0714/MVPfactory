import type { ConnectionProbe, SettingsRepository } from "@/application/ports";
import { parseProvider, parseUpdateSettings } from "@/domain/validation";

export function createSettingsUseCases(
  settings: SettingsRepository,
  probe: ConnectionProbe,
) {
  return {
    get: () => settings.get(),
    update: (body: unknown) => settings.update(parseUpdateSettings(body)),
    /** 공급자에 실제로 확인한 결과만 저장한다. 확인하지 못하면(연결 실패) 이전 상태를 바꾸지 않는다. */
    async verify(provider: string) {
      const connection = await probe.check(parseProvider(provider));
      return settings.saveConnection(connection);
    },
  };
}
