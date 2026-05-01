/**
 * GRIHA AI WORKER — FINAL (Optimized Rendering)
 */

const MODEL = 'claude-opus-4-6';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' }
  });
}

function addCors(r) {
  const res = new Response(r.body, r);
  Object.entries(CORS).forEach(([k, v]) => res.headers.set(k, v));
  return res;
}

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    try {
      return addCors(await route(req, env));
    } catch (e) {
      console.error(e);
      return jsonRes({ error: e.message }, 500);
    }
  }
};

async function route(req, env) {
  const path = new URL(req.url).pathname;

  if (path === '/health') return jsonRes({ status: 'ok' });

  if (req.method !== 'POST') return jsonRes({ error: 'POST required' }, 405);

  if (path === '/generate-render') return handleRender(req, env);

  return jsonRes({ error: 'Not found' }, 404);
}

/**
 * 🔥 FIXED RENDER FUNCTION
 */
async function handleRender(req, env) {
  if (!env.STABILITY_API_KEY) {
    return jsonRes({ ok: false, error: 'Missing STABILITY_API_KEY' }, 503);
  }

  const { design_style_id, palette_id, room_type, roomImageBase64 } =
    await req.json().catch(() => ({}));

  const STYLES = {
    contemporary_indian: 'repaint walls warm terracotta, replace floor beige stone',
    minimalist_modern: 'white walls, light grey flooring',
    japandi: 'warm greige walls, light wood flooring',
  };

  const PALETTES = {
    warm: 'warm earth tones',
    neutral: 'neutral whites and greys'
  };

  const style = STYLES[design_style_id] || STYLES.contemporary_indian;
  const palette = PALETTES[palette_id] || PALETTES.warm;

  const room = (room_type || 'room').replace(/_/g, ' ');

  // 🔥 STRUCTURE-LOCKED PROMPT
  const prompt = [
    `This is a real photograph of a ${room}.`,
    `Preserve EXACT layout, geometry, walls, windows, and perspective.`,
    `DO NOT change structure.`,
    `Only modify surfaces: ${style}.`,
    `Use palette: ${palette}.`,
    `Same room after renovation.`,
    `Highly realistic.`
  ].join(' ');

  const negP = [
    'different room',
    'new layout',
    'extra windows',
    'distorted',
    '3d render',
    'cartoon',
    'blurry'
  ].join(',');

  try {
    const imgBytes = Uint8Array.from(atob(roomImageBase64), c => c.charCodeAt(0));

    const boundary = 'boundary';
    const CRLF = '\r\n';
    const enc = new TextEncoder();

    const fields = [
      ['init_image_mode', 'IMAGE_STRENGTH'],
      ['image_strength', '0.25'],
      ['cfg_scale', '8.5'],
      ['steps', '30'],
      ['text_prompts[0][text]', prompt],
      ['text_prompts[0][weight]', '1'],
      ['text_prompts[1][text]', negP],
      ['text_prompts[1][weight]', '-1']
    ];

    let bodyText = '';

    for (const [k, v] of fields) {
      bodyText += `--${boundary}${CRLF}`;
      bodyText += `Content-Disposition: form-data; name="${k}"${CRLF}${CRLF}${v}${CRLF}`;
    }

    bodyText += `--${boundary}${CRLF}`;
    bodyText += `Content-Disposition: form-data; name="init_image"; filename="room.jpg"${CRLF}`;
    bodyText += `Content-Type: image/jpeg${CRLF}${CRLF}`;

    const bodyStart = enc.encode(bodyText);
    const bodyEnd = enc.encode(`${CRLF}--${boundary}--`);

    const body = new Uint8Array(bodyStart.length + imgBytes.length + bodyEnd.length);
    body.set(bodyStart, 0);
    body.set(imgBytes, bodyStart.length);
    body.set(bodyEnd, bodyStart.length + imgBytes.length);

    const res = await fetch(
      'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.STABILITY_API_KEY}`,
          Accept: 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`
        },
        body
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return jsonRes({ ok: false, error: err }, 500);
    }

    const data = await res.json();
    const image = data.artifacts?.[0]?.base64;

    return jsonRes({
      ok: true,
      image_base64: image,
      mime_type: 'image/png'
    });

  } catch (e) {
    return jsonRes({ ok: false, error: e.message }, 500);
  }
}
