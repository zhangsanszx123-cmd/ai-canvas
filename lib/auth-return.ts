export function authReturnPath(value: string | null) {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    /[\\\u0000-\u001f]/.test(value)
  )
    return "/protected";
  try {
    const url = new URL(value, "https://canvas.invalid");
    if (url.origin !== "https://canvas.invalid") return "/protected";
    if (
      !["/", "/protected", "/canvas", "/projects", "/skills"].includes(
        url.pathname,
      )
    )
      return "/protected";
    return url.pathname + url.search;
  } catch {
    return "/protected";
  }
}
