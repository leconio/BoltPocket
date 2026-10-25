import { redirectLocalBenchmarkSystemPath } from "@/infrastructure/navigation/local-benchmark-link-routing";

export function redirectSystemPath({
  path,
}: {
  path: string;
  initial: boolean;
}) {
  return redirectLocalBenchmarkSystemPath(path);
}
