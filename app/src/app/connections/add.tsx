import { ConnectionCatalogScreen } from "@/features/connections/connection-catalog-screen";
import { ProjectConnectionRoute } from "@/features/connections/project-connection-route";

export default function AddConnectionRoute() {
  return (
    <ProjectConnectionRoute>
      <ConnectionCatalogScreen />
    </ProjectConnectionRoute>
  );
}
