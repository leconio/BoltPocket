import { NotionConnectionScreen } from "@/features/connections/notion-connection-screen";
import { ProjectConnectionRoute } from "@/features/connections/project-connection-route";

export default function NotionConnectionRoute() {
  return (
    <ProjectConnectionRoute>
      <NotionConnectionScreen />
    </ProjectConnectionRoute>
  );
}
