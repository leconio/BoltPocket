export function isExplicitSkillPublicationRequest(value: string) {
  const normalized = value
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("en-US");
  if (!normalized || normalized.length > 2_000) return false;
  if (
    /(?:不要|别|取消|停止|撤销|暂不).{0,8}(?:发布|上传|上架)|(?:do not|don't|cancel|stop|skip).{0,20}(?:publish|upload|list)/iu.test(
      normalized,
    )
  ) {
    return false;
  }
  const compact = normalized
    .replace(/[。.!！]+$/gu, "")
    .replace(/[，,、]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (
    /^(?:(?:确认|继续|现在|请)?\s*(?:发布|上传|上架)(?:\s*(?:吧|它|这个(?:\s*skill)?|该(?:\s*skill)?))?|(?:publish|upload|list)(?:\s+(?:it|this skill))?)$/iu.test(
      compact,
    )
  ) {
    return true;
  }
  return /(?:发布|上传|上架).{0,16}(?:skill|技能|市场)|(?:skill|技能).{0,16}(?:发布|上传|上架)|(?:publish|upload|list).{0,20}(?:skill|market)/iu.test(
    normalized,
  );
}
