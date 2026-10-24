import { GoogleDocsConnectionScreen } from "@/features/connections/google-docs-connection-screen";
import { ProjectConnectionRoute } from "@/features/connections/project-connection-route";

export default function GoogleDocsConnectionRoute() {
  return (
    <ProjectConnectionRoute>
      <GoogleDocsConnectionScreen />
    </ProjectConnectionRoute>
  );
}
