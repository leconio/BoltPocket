import type { BuiltInProjectResourcePackId } from "@/domain/builtin-project-resources";

export interface ProjectResourceFilePort {
  readBase64(
    packId: BuiltInProjectResourcePackId,
    path: string,
  ): Promise<string>;
}
