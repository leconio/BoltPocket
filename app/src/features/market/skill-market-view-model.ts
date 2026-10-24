import type {
  SkillMarketCategory,
  SkillMarketSummary,
} from "@/application/ports/skill-market";
import type { MessageKey } from "@/i18n/messages";

export const marketCategories = [
  "engineering",
  "operations",
  "privacy",
  "productivity",
  "research",
  "writing",
] as const satisfies readonly SkillMarketCategory[];

export const categoryMessage = {
  engineering: "market.category.engineering",
  operations: "market.category.operations",
  privacy: "market.category.privacy",
  productivity: "market.category.productivity",
  research: "market.category.research",
  writing: "market.category.writing",
} as const satisfies Record<SkillMarketCategory, MessageKey>;

export type SkillMarketSort = "featured" | "name" | "newest";

export function selectMarketEntries(
  entries: readonly SkillMarketSummary[],
  options: Readonly<{
    category: SkillMarketCategory | "all";
    locale: "en" | "zh-CN";
    query?: string;
    sort: SkillMarketSort;
  }>,
): readonly SkillMarketSummary[] {
  const term = options.query?.trim().toLocaleLowerCase(options.locale) ?? "";
  const filtered = entries.filter((entry) => {
    if (options.category !== "all" && entry.category !== options.category) {
      return false;
    }
    if (!term) return true;
    return [
      entry.name.zhCN,
      entry.name.en,
      entry.description.zhCN,
      entry.description.en,
      entry.provider.zhCN,
      entry.provider.en,
      entry.category,
      ...entry.tags,
    ]
      .join("\n")
      .toLocaleLowerCase(options.locale)
      .includes(term);
  });
  const localizedName = (entry: SkillMarketSummary) =>
    options.locale === "zh-CN" ? entry.name.zhCN : entry.name.en;
  const byName = (left: SkillMarketSummary, right: SkillMarketSummary) =>
    localizedName(left).localeCompare(localizedName(right), options.locale);
  return [...filtered].sort((left, right) => {
    if (options.sort === "name") return byName(left, right);
    if (options.sort === "newest") {
      return right.publishedAt - left.publishedAt || byName(left, right);
    }
    return (
      Number(right.featured) - Number(left.featured) ||
      Number(right.verified) - Number(left.verified) ||
      right.publishedAt - left.publishedAt ||
      byName(left, right)
    );
  });
}
