// /api/og: the 1200×630 picture social apps show for a shared link.
//   ?g=<gameId>  that game's verified score card
//   ?c=<code>    a challenge invite
//   (nothing)    the game's own preview
import { ImageResponse } from '@vercel/og';
import { lookup, dailyNumber, fmt } from './_shared.js';

const C = { bg: '#0d0f15', tile: '#171a23', line: '#2a2f3d', ink: '#eef0f6', muted: '#9298ab', left: '#7d8bff', right: '#ff7aa6', good: '#43c98a', warn: '#f2ae4e' };
const h = (style, ...children) => ({ type: 'div', props: { style: { display: 'flex', ...style }, children: children.flat().filter(c => c !== null && c !== false) } });

// Google Fonts gives TrueType to clients that don't ask for woff2, which is what the renderer needs.
async function font(family, weight) {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weight}`)).text();
    const src = css.match(/src: url\((.+?)\) format\('(opentype|truetype)'\)/);
    if (!src) return null;
    return { name: family, data: await (await fetch(src[1])).arrayBuffer(), weight, style: 'normal' };
  } catch { return null; }
}

const brand = tag => h({ justifyContent: 'space-between', alignItems: 'center', width: '100%' },
  h({ alignItems: 'center', gap: 16 },
    h({ gap: 6 }, h({ width: 18, height: 34, borderRadius: 5, background: C.left }), h({ width: 18, height: 34, borderRadius: 5, background: C.right })),
    h({ fontFamily: 'Bricolage Grotesque', fontSize: 34, fontWeight: 800 }, 'Left or Right')),
  tag ? h({ fontSize: 22, fontWeight: 700, letterSpacing: 2, color: C.muted, border: `2px solid ${C.line}`, borderRadius: 999, padding: '8px 20px' }, tag) : null);

const footer = left => h({ justifyContent: 'space-between', alignItems: 'center', width: '100%' },
  h({ fontFamily: 'Bricolage Grotesque', fontSize: 38, fontWeight: 800 }, left),
  h({ fontSize: 24, color: C.muted }, 'left-or-right-peach.vercel.app'));

const pads = n => h({ flexDirection: 'column', alignItems: 'center', gap: 26 },
  h({ width: 230, height: 230, borderRadius: 999, border: `16px solid ${C.left}`, alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Bricolage Grotesque', fontSize: 130, fontWeight: 800 }, String(n)),
  h({ gap: 14 },
    h({ background: C.left, color: C.bg, borderRadius: 18, padding: '18px 26px', fontSize: 30, fontWeight: 800 }, '← ODD'),
    h({ background: C.right, color: C.bg, borderRadius: 18, padding: '18px 26px', fontSize: 30, fontWeight: 800 }, 'EVEN →')));

const tile = (v, k) => h({ flexDirection: 'column', width: 236, background: C.tile, borderRadius: 24, padding: '22px 26px', gap: 4 },
  h({ fontFamily: 'Bricolage Grotesque', fontSize: 52, fontWeight: 800 }, v),
  h({ fontSize: 22, color: C.muted }, k));

function gameCard(s) {
  const tag = s.mode === 'daily' ? `DAILY #${dailyNumber(s.day)}` : s.mode === 'challenge' ? 'CHALLENGE' : `${s.rounds} ROUNDS${s.hard ? ' · HARD' : ''}`;
  const badge = s.rank === 1 ? (s.mode === 'daily' ? '#1 today' : '#1 on the leaderboard') : s.correct === s.rounds ? 'Perfect round' : s.rank ? `#${s.rank} of ${s.of}` : null;
  return [
    brand(tag),
    h({ flex: 1, alignItems: 'center', justifyContent: 'space-between', width: '100%' },
      h({ flexDirection: 'column' },
        h({ fontSize: 32, color: C.muted }, `${s.nickname} scored`),
        h({ fontFamily: 'Bricolage Grotesque', fontSize: 200, fontWeight: 800, lineHeight: 1, letterSpacing: -6 }, fmt(s.score)),
        badge ? h({ marginTop: 18, background: 'rgba(67,201,138,0.16)', color: C.good, borderRadius: 999, padding: '10px 24px', fontSize: 28, fontWeight: 700, alignSelf: 'flex-start' }, badge) : null),
      h({ flexWrap: 'wrap', width: 496, gap: 24 },
        tile(`${s.correct}/${s.rounds}`, 'Correct'),
        tile(s.avgMs ? `${(s.avgMs / 1000).toFixed(2)}s` : '–', 'Avg answer'),
        tile(String(s.bestStreak ?? 0), 'Best streak'),
        tile(s.rank ? `#${s.rank}` : `${Math.round((s.correct / s.rounds) * 100)}%`, s.rank ? (s.mode === 'daily' ? 'Today' : 'Rank') : 'Accuracy'))),
    footer('Can you beat it?'),
  ];
}

function challengeCard(c) {
  const who = c.nickname || 'A friend';
  return [
    brand('CHALLENGE'),
    h({ flex: 1, alignItems: 'center', justifyContent: 'space-between', width: '100%' },
      h({ flexDirection: 'column', maxWidth: 640 },
        h({ fontSize: 34, color: C.muted }, `${who} challenged you`),
        h({ fontFamily: 'Bricolage Grotesque', fontSize: c.score != null ? 150 : 110, fontWeight: 800, lineHeight: 1, letterSpacing: -4, marginTop: 8 },
          c.score != null ? `Beat ${fmt(c.score)}` : 'Can you beat them?'),
        h({ fontSize: 30, color: C.ink, marginTop: 22 }, `Same ${c.rounds} questions${c.hard ? ' on Hard' : ''} · one try`)),
      pads(7)),
    footer('Your turn.'),
  ];
}

const siteCard = () => [
  brand(null),
  h({ flex: 1, alignItems: 'center', justifyContent: 'space-between', width: '100%' },
    h({ flexDirection: 'column', width: 660 },
      h({ fontFamily: 'Bricolage Grotesque', fontSize: 74, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }, 'Odd or even.'),
      h({ fontFamily: 'Bricolage Grotesque', fontSize: 74, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2 }, 'Low or high.'),
      h({ fontFamily: 'Bricolage Grotesque', fontSize: 74, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: C.left }, 'Three seconds.'),
      h({ fontSize: 28, color: C.muted, marginTop: 22 }, 'Daily challenge · friend challenges')),
    pads(6)),
  footer('Play free in your browser'),
];

export const config = { runtime: 'edge' };

export default async function handler(request) {
  const info = await lookup(new URL(request.url));
  const fonts = (await Promise.all([font('Bricolage Grotesque', 800), font('Inter', 500), font('Inter', 700)])).filter(Boolean);
  const body = info.kind === 'game' ? gameCard(info) : info.kind === 'challenge' ? challengeCard(info) : siteCard();
  const root = h({
    width: 1200, height: 630, flexDirection: 'column', justifyContent: 'space-between', padding: '52px 64px',
    background: C.bg, color: C.ink, fontFamily: 'Inter',
    backgroundImage: `radial-gradient(circle at 8% 0%, rgba(125,139,255,0.30), transparent 45%), radial-gradient(circle at 96% 0%, rgba(255,122,166,0.24), transparent 45%)`,
  }, body);
  return new ImageResponse(root, {
    width: 1200, height: 630, fonts: fonts.length ? fonts : undefined,
    headers: { 'cache-control': info.kind === 'game' ? 'public, max-age=86400, s-maxage=604800, immutable' : 'public, max-age=600, s-maxage=3600' },
  });
}
