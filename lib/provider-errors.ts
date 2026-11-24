// Only return our own messages: provider errors may contain credentials or URLs.
export function providerFailureMessage(error: unknown, status?: number) {
  const details =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code =
    typeof details.code === "string" ? details.code.toLowerCase() : "";
  const message =
    typeof details.message === "string" ? details.message.toLowerCase() : "";
  const reason = `${code} ${message}`;
  if (
    /content[_ -]?(policy|filter|safety)|moderation|safety[_ -]?(check|system)|内容.*(审核|安全|政策)|安全审核/.test(
      reason,
    )
  )
    return "请求未通过内容安全审核，请调整提示词或更换参考图后重试";
  if (
    /insufficient[_ -]?(balance|quota|credit|funds)|余额不足|额度不足|积分不足|欠费/.test(
      reason,
    ) ||
    status === 402
  )
    return "生图服务账户余额或额度不足，请联系管理员检查账户";
  if (
    /invalid[_ -]?(api[_ -]?)?key|authentication|unauthorized|密钥.*(无效|过期)/.test(
      reason,
    ) ||
    status === 401
  )
    return "生图服务认证失败，请联系管理员检查 API 密钥";
  if (
    /permission[_ -]?denied|access[_ -]?denied|model[_ -]?(not[_ -]?found|unavailable)|模型.*(无权限|不可用|不存在)|权限不足/.test(
      reason,
    ) ||
    status === 403
  )
    return "生图模型不可用或无访问权限，请联系管理员检查模型配置和权限";
  if (
    /rate[_ -]?limit|too many requests|限流|请求过于频繁/.test(reason) ||
    status === 429
  )
    return "生图服务请求过于频繁，请稍后重试";
  if (
    /invalid[_ -]?(parameter|argument|request)|参数.*(无效|错误|不支持)/.test(
      reason,
    ) ||
    status === 400 ||
    status === 422
  )
    return "生图请求参数不受支持，请调整图片配置或参考图后重试";
  return "图片生成失败，供应商未提供可识别的原因，请稍后重试或联系管理员";
}
