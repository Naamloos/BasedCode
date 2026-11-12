/** Validate browser network targets; origin access is approved separately. */
export function localBrowserUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:", "ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      "Browser requests require HTTP(S) or WS(S) URLs without credentials.",
    );
  }
  return url;
}
