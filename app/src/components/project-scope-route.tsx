import { Redirect, useLocalSearchParams } from "expo-router";
import type { PropsWithChildren } from "react";

import {
  createAppStateFieldsSelector,
  useAppStateSelector,
} from "@/providers/app-provider";

const selectProjectScopeState = createAppStateFieldsSelector("projects");

/**
 * Protects capability routes whose persisted state and runtime access must be
 * owned by one existing project. Route components still read projectId from
 * Expo Router after this guard has validated it.
 */
export function ProjectScopeRoute({ children }: PropsWithChildren) {
  const { projectId } = useLocalSearchParams<{ projectId?: string }>();
  const state = useAppStateSelector(selectProjectScopeState);

  if (!projectId || !state.projects[projectId]) {
    return <Redirect href="/projects" />;
  }

  return children;
}
