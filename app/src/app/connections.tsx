import { LibraryScreen } from "@/features/library/library-screen";
import { ProjectConnectionRoute } from "@/features/connections/project-connection-route";

export default function ConnectionsRoute() {
  return (
    <ProjectConnectionRoute>
      <LibraryScreen kind="connections" />
    </ProjectConnectionRoute>
  );
}
