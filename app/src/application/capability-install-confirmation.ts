export function isExplicitCapabilityInstallConfirmation(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!normalized || normalized.length > 240) return false;
  if (
    /(?:不要|不安装|别装|取消|拒绝|暂不|not\s+install|do\s+not|don't|cancel|decline)/iu.test(
      normalized,
    )
  ) {
    return false;
  }
  const affirmative = normalized
    .replace(/[。.!！]+$/gu, "")
    .replace(/[，,、]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    /^(?:确认|同意|允许|可以|好的?|好|行|是的|安装|装上|添加到项目|yes(?: (?:go ahead|proceed))?|confirm(?:ed)?(?: (?:go ahead|proceed))?|approved?(?: (?:go ahead|proceed))?|go ahead|proceed|install(?: it| this)?|add (?:it|this))$/iu.test(
      affirmative,
    )
  ) {
    return true;
  }
  return (
    /(?:安装|装上|添加到项目|install|add\s+(?:it|this))/iu.test(normalized) &&
    /(?:确认|同意|允许|可以|好的?|好|行|是的|接受|继续|请|现在|吧|yes|confirm|approved?|go ahead|proceed)/iu.test(
      normalized,
    )
  );
}
