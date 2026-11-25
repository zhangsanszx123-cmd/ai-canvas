// Only display surfaces use previews. Downloads, model references and the
// full-size viewer keep the original URL.
export function imageDisplayUrl(url: string) {
  return /^\/api\/(?:public\/)?assets\/[^/?]+\/content$/.test(url)
    ? `${url}?preview=1`
    : url;
}
