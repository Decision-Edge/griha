/**
 * GRIHA AI WORKER — v7 (FIXED RENDER)
 */

const MODEL = 'claude-opus-4-6';

const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonRes(data, status=200) {
  return new Response(JSON.stringify(data), { status, headers:{...CORS,'Content-Type':'application/json'} });
}
function addCors(r) {
  const res = new Response(r.body, r);
  Object.entries(CORS).forEach(([k,v])=>res.headers.set(k,v));
  return res;
}
function getClientIP(req) {
  return req.headers.get('CF-Connecting-IP') || req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() || 'unknown';
}

// ── Rate limiting ────────────────────────────────────────────────────────────
async function checkRateLimit() { return { allowed: true }; }
async function consumeCredit() {}

// ── Main handler ─────────────────────────────────────────────────────────────
export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { status:204, headers:CORS });
    try {
      return addCors(await route(req, env));
    } catch(e) {
      console.error('Worker error:', e.message);
      return jsonRes({ error:e.message }, 500);
    }
  }
};

async function route(req, env) {
  const path = new URL(req.url).pathname;

  if (path === '/health') return jsonRes({ status:'ok', version:'v7' });

  if (req.method !== 'POST') return jsonRes({ error:'POST required' }, 405);

  if (path === '/generate-render') return handleRender(req, env);

  return jsonRes({ error:'Not found' }, 404);
}

// ── /generate-render — FIXED VERSION ─────────────────────────────────────────
async function handleRender(req, env) {
  if (!env.STABILITY_API_KEY) {
    return jsonRes({ ok:false, error:'STABILITY_API_KEY not set' }, 503);
  }

  const { design_style_id, palette_id, room_type, roomImageBase64 } = await req.json().catch(()=>({}));

  if (!roomImageBase64) {
    return jsonRes({ ok:false, error:'No image provided' }, 400);
  }

  // ✅ CLEAN BASE64
  let cleanBase64 = roomImageBase64;
  if (cleanBase64.startsWith('data:')) {
    cleanBase64 = cleanBase64.split(',')[1];
  }

  let imgBytes;
  try {
    imgBytes = Uint8Array.from(atob(cleanBase64), c => c.charCodeAt(0));
  } catch {
    return jsonRes({ ok:false, error:'Invalid base64 image' }, 400);
  }

  const room = (room_type||'room').replace(/_/g,' ');

  const STYLES = {
    contemporary_indian: 'repaint walls warm terracotta, replace floor beige stone',
    minimalist_modern: 'white walls, light grey floor',
    japandi: 'warm greige walls, light wood floor'
  };

  const PALETTES = {
    warm_earthen:'warm earthy tones',
    cloud_white:'neutral whites and greys'
  };

  const style   = STYLES[design_style_id] || STYLES.contemporary_indian;
  const palette = PALETTES[palette_id] || PALETTES.warm_earthen;

  // ✅ BETTER PROMPT
  const prompt = [
    `This is a real photograph of a ${room}.`,
    `Preserve exact layout, walls, windows, and camera angle.`,
    `Do not change structure.`,
    `Only modify surfaces: ${style}.`,
    `Apply palette: ${palette}.`,
    `Same room after renovation.`,
    `Highly realistic photo.`
  ].join(' ');

  // ✅ STRONG NEGATIVE
  const negP = [
    'different room',
    'new layout',
    'changed perspective',
    'extra windows',
    'distorted',
    'new furniture',
    'removed furniture',
    'cartoon',
    '3d render',
    'blurry'
  ].join(',');

  try {
    const boundary = 'grihaBoundary' + Date.now();
    const enc = new TextEncoder();
    const CRLF = '\r\n';

    const fields = [
      ['init_image_mode', 'IMAGE_STRENGTH'],
      ['image_strength', '0.28'],
      ['cfg_scale', '8.5'],
      ['steps', '32'],
      ['samples', '1'],
      ['text_prompts[0][text]', prompt],
      ['text_prompts[0][weight]', '1'],
      ['text_prompts[1][text]', negP],
      ['text_prompts[1][weight]', '-1.1'],
    ];

    let textParts = '';
    for (const [name, value] of fields) {
      textParts += '--' + boundary + CRLF +
        'Content-Disposition: form-data; name="' + name + '"' +
        CRLF + CRLF + value + CRLF;
    }

    const imgHeader =
      '--' + boundary + CRLF +
      'Content-Disposition: form-data; name="init_image"; filename="room.jpg"' +
      CRLF +
      'Content-Type: image/jpeg' +
      CRLF + CRLF;

    const imgFooter = CRLF + '--' + boundary + '--' + CRLF;

    const textBytes = enc.encode(textParts + imgHeader);
    const footerBytes = enc.encode(imgFooter);

    const body = new Uint8Array(textBytes.length + imgBytes.length + footerBytes.length);
    body.set(textBytes, 0);
    body.set(imgBytes, textBytes.length);
    body.set(footerBytes, textBytes.length + imgBytes.length);

    const r = await fetch(
      'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/image-to-image',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.STABILITY_API_KEY}`,
          'Accept': 'application/json',
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }
    );

    if (!r.ok) {
      const errText = await r.text().catch(()=>'');
      console.error('img2img failed:', r.status, errText);
      return jsonRes({ ok:false, error:`Stability API ${r.status}`, details: errText.slice(0,200) }, 500);
    }

    const data = await r.json();
    const b64  = data.artifacts?.[0]?.base64;

    if (!b64) {
      return jsonRes({ ok:false, error:'No image returned' }, 500);
    }

    return jsonRes({ ok:true, image_base64:b64, mime_type:'image/png' });

  } catch(e) {
    console.error('Render error:', e.message);
    return jsonRes({ ok:false, error:e.message }, 500);
  }
}
