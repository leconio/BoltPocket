import type {
  ConnectionItem,
  Project,
  WorkspaceResource,
} from "../../domain/models.ts";

export type NativeTextConnectionBundle = {
  connection: ConnectionItem;
  resources: WorkspaceResource[];
};

export interface NativeTextConnectionService {
  load(): Promise<NativeTextConnectionBundle[]>;
  connect(project: Project): Promise<NativeTextConnectionBundle | null>;
  refresh(resources: WorkspaceResource[]): Promise<WorkspaceResource[]>;
}
