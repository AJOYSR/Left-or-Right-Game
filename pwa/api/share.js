// /s/<gameId> and /c/<code>: a tiny page that carries the link preview (title, text and the score
// picture) for LinkedIn, X, WhatsApp and the rest, then sends people straight into the game.
import { lookup, texts, esc, SITE } from './_shared.js';

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const url = new URL(request.url);
  const info = await lookup(url);
  const { title, description } = texts(info);
  const self = info.kind === 'game' ? `${SITE}/s/${info.id}` : info.kind === 'challenge' ? `${SITE}/c/${info.code}` : SITE;
  const image = info.kind === 'game' ? `${SITE}/api/og?g=${info.id}` : info.kind === 'challenge' ? `${SITE}/api/og?c=${info.code}` : `${SITE}/api/og`;
  const next = info.kind === 'challenge' ? `/#c-${info.code}` : info.kind === 'game' ? `/?s=${info.id}` : '/';
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(self)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Left or Right">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(self)}">
<meta property="og:image" content="${esc(image)}">
<meta property="og:image:secure_url" content="${esc(image)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(title)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${esc(image)}">
<meta http-equiv="refresh" content="0; url=${esc(next)}">
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0d0f15;color:#eef0f6;font:16px system-ui,sans-serif}a{color:#7d8bff}</style>
</head>
<body><p><a href="${esc(next)}">Play Left or Right</a></p></body>
</html>`;
  return new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // a finished game never changes, so previews can be cached; challenges update as friends play
      'cache-control': info.kind === 'game' ? 'public, max-age=300, s-maxage=86400' : 'public, max-age=60, s-maxage=600',
    },
  });
}
