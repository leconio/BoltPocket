import { Redirect, useLocalSearchParams } from "expo-router";

import { LibraryCreateScreen } from "@/features/library/library-create-screen";

export default function LibraryCreateRoute() {
  const { kind, projectId } = useLocalSearchParams<{
    kind?: string;
    projectId?: string;
  }>();

  if (kind === "skill") {
    return (
      <Redirect
        href={{
          pathname: "/skills/add",
          params: projectId ? { projectId } : {},
        }}
      />
    );
  }

  return <LibraryCreateScreen />;
}
