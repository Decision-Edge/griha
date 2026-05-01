/**
 * GRIHA AI WORKER — v5
 * Endpoints: /health /validate-photo /analyze-room /analyze-masterplan /generate-render /suggest-changes
 * Secrets:   ANTHROPIC_API_KEY
 * Bindings:  AI (Workers AI)
 */
const ANTHROPIC_MODEL   = 'claude-opus-4-6';
const IMG_MODEL_XL      = '@cf/stabilityai/stable-diffusion-xl-base-1.0';
const IMG_MODEL_IMG2IMG = '@cf/runwayml/stable-diffusion-v1-5-img2img';

// Always added to every response — including error responses from the platform
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── Rate limiting (free tier: 1 analysis + 1 render per IP per day) ───────────
const FREE_TIER = { analyses: 1, renders: 1 };

async function checkRateLimit(env, ip, type) {
  if (!env.RATE_KV) return { allowed: true }; // KV not configured — fail open

  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key   = `rate:${ip}:${today}`;

  let counts = { analyses: 0, renders: 0 };
  try {
    const stored = await env.RATE_KV.get(key);
    if (stored) counts = JSON.parse(stored);
  } catch(e) { return { allowed: true }; } // KV read error — fail open

  const limit = FREE_TIER[type + 's']; // 'analysis' → 'analyses', 'render' → 'renders'
  if (counts[type + 's'] >= limit) {
    return { allowed: false, used: counts[type + 's'], limit };
  }
  return { allowed: true, used: counts[type + 's'], limit };
}

async function consumeCredit(env, ip, type) {
  if (!env.RATE_KV) return;
  const today = new Date().toISOString().slice(0, 10);
  const key   = `rate:${ip}:${today}`;

  let counts = { analyses: 0, renders: 0 };
  try {
    const stored = await env.RATE_KV.get(key);
    if (stored) counts = JSON.parse(stored);
    counts[type + 's'] = (counts[type + 's'] || 0) + 1;
    // TTL of 25 hours so the key auto-cleans after the day resets
    await env.RATE_KV.put(key, JSON.stringify(counts), { expirationTtl: 90000 });
  } catch(e) { /* fail silently */ }
}

function getClientIP(req) {
  return req.headers.get('CF-Connecting-IP') ||
         req.headers.get('X-Forwarded-For')?.split(',')[0]?.trim() ||
         'unknown';
}

function addCors(response) {
  const r = new Response(response.body, response);
  Object.entries(CORS_HEADERS).forEach(([k,v]) => r.headers.set(k,v));
  return r;
}

function jsonRes(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type':'application/json' }
  });
}

export default {
  async fetch(req, env) {
    // Handle CORS preflight
    if (req.method === 'OPTIONS') {
      return new Response(null, { status:204, headers:CORS_HEADERS });
    }

    try {
      const response = await handleRequest(req, env);
      return addCors(response);
    } catch(e) {
      console.error('Unhandled worker error:', e);
      return jsonRes({ error: e.message || 'Internal server error' }, 500);
    }
  }
};

async function handleRequest(req, env) {
  const path = new URL(req.url).pathname;

  // Health + debug are GET endpoints — must be before the POST gate
  if (path === '/health') return jsonRes({
    status:'ok', version:'v6',
    has_anthropic_key: !!(env.ANTHROPIC_API_KEY),
    has_stability_key: !!(env.STABILITY_API_KEY),
    has_rate_kv:       !!(env.RATE_KV),
  });

  if (path === '/debug') return jsonRes({
    has_anthropic_key: !!(env.ANTHROPIC_API_KEY),
    has_stability_key: !!(env.STABILITY_API_KEY),
    has_rate_kv:       !!(env.RATE_KV),
    version:           'v6',
    timestamp:         new Date().toISOString(),
    fix_503:           !env.STABILITY_API_KEY ? 'STABILITY_API_KEY missing — add in Worker Settings → Variables and Secrets' : 'OK',
    fix_500:           !env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY missing — add in Worker Settings → Variables and Secrets' : 'OK',
  });

  if (req.method !== 'POST') return jsonRes({ error:'POST required for this endpoint' }, 405);

  if (path === '/validate-photo')     return handleValidate(req, env);
  if (path === '/analyze-room')       return handleAnalyze(req, env);
  if (path === '/analyze-masterplan') return handleMasterplan(req, env);
  if (path === '/generate-render')    return handleRender(req, env);
  if (path === '/suggest-changes')    return handleChat(req, env);

  return jsonRes({ error:'Unknown endpoint' }, 404);
}

// ── VALIDATE PHOTO ──────────────────────────────────────────────────────────
async function handleValidate(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ is_valid_room:true, _skipped:true, reason:'No API key' });
  try {
    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) return jsonRes({ is_valid_room:true, _skipped:true });

    const reply = await claude(env, [{
      role: 'user',
      content: [
        { type:'image', source:{ type:'base64', media_type: mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text', text:'Is this image an interior room of a building? Reply ONLY with valid JSON: {"is_valid_room":true} or {"is_valid_room":false,"reason":"brief reason"}. No markdown.' }
      ]
    }], null, 80);

    const parsed = parseJSON(reply);
    if (typeof parsed.is_valid_room !== 'boolean') return jsonRes({ is_valid_room:true, _skipped:true });
    return jsonRes(parsed);
  } catch(e) {
    return jsonRes({ is_valid_room:true, _skipped:true });
  }
}

// ── ANALYZE ROOM ─────────────────────────────────────────────────────────────
async function handleAnalyze(req, env) {
  // NEVER return 500 — always return something useful
  try {
    if (!env.ANTHROPIC_API_KEY) {
      return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set. Add in Worker Settings → Variables and Secrets.' });
    }

    const ip = getClientIP(req);

    // Rate limit — wrapped in try/catch so a KV failure never blocks analysis
    let ratePassed = true;
    try {
      const rateCheck = await checkRateLimit(env, ip, 'analysis');
      if (!rateCheck.allowed) {
        return jsonRes({
          ok: false, limit_reached: true, type: 'analysis',
          message: "You've used your free room analysis. Buy a credit pack to analyse more rooms.",
          packs: [
            { name: 'Starter',   price: 299, includes: '3 rooms + 5 renders', tag: 'starter' },
            { name: 'Full Home', price: 799, includes: 'Unlimited rooms + renders', tag: 'full_home' }
          ]
        }, 429);
      }
    } catch(rateErr) {
      console.warn('Rate limit check failed (non-fatal):', rateErr.message);
      ratePassed = false; // skip consumeCredit if rate check failed
    }

    // Parse request body
    let body;
    try { body = await req.json(); }
    catch(e) { return jsonRes({ ok:false, error:'Could not parse request. Please try again.' }, 400); }

    const { imageBase64, mimeType, roomLabel } = body || {};
    if (!imageBase64) return jsonRes({ ok:false, error:'No image received. Please try uploading the photo again.' }, 400);

    // Size check — Anthropic rejects base64 images over ~5MB
    if (imageBase64.length > 6_800_000) {
      return jsonRes({ ok:false, error:'Photo too large for analysis. It will be resized automatically — please try again.' }, 413);
    }

    const prompt = `You are an expert interior design analyst for Indian homes.
Analyse this ${roomLabel||'room'} photo. Return ONLY a valid JSON object. No markdown, no explanation, no text outside the JSON.

Use this exact structure (replace all values with what you observe):
{"room_identified":true,"confidence":"high","observations":{"estimated_sqft":160,"ceiling_height":"standard","ceiling_type":"flat","window_count":1,"light_direction":"east","light_quality":"bright","natural_light_assessment":"Good natural light","overhead_beams_detected":false,"beam_count":0,"electrical_points_visible":2,"electrical_point_positions":["near_door","opposite_wall"],"existing_furniture":["bed","wardrobe"],"wall_colours_existing":["white"],"flooring_type":"vitrified_tile","flooring_colour":"beige","ceiling_colour":"white","wall_condition":"good","style_detected":["contemporary_indian"],"vastu_observations":{"sleeping_head_direction_visible":"unknown","mirror_facing_bed":false}}}`;

    // Call Claude — if this fails, return a usable fallback (never 500)
    let reply;
    try {
      reply = await claude(env, [{
        role: 'user',
        content: [
          { type:'image', source:{ type:'base64', media_type: mimeType||'image/jpeg', data: imageBase64 } },
          { type:'text',  text: prompt }
        ]
      }], null, 1024);
    } catch(claudeErr) {
      console.error('Claude API error:', claudeErr.message);
      // Return a fallback with an error flag — app will show amber banner
      return jsonRes(buildFallback(claudeErr.message));
    }

    if (!reply) return jsonRes(buildFallback('Empty response from Claude'));

    const parsed = parseJSON(reply);
    if (parsed.error || !parsed.observations) return jsonRes(buildFallback('Could not parse analysis'));

    // Consume credit only on real success
    if (ratePassed) {
      try { await consumeCredit(env, ip, 'analysis'); } catch(e) { /* non-fatal */ }
    }

    return jsonRes(parsed);

  } catch(e) {
    console.error('Unexpected handleAnalyze error:', e.message);
    return jsonRes(buildFallback(e.message));
  }
}

function buildFallback(reason) {
  return {
    room_identified: true,
    confidence: 'low',
    _fallback: true,
    _fallback_reason: reason,
    observations: {
      estimated_sqft: 150, ceiling_height: 'standard', ceiling_type: 'flat',
      window_count: 1, light_direction: 'east', light_quality: 'moderate',
      natural_light_assessment: 'Moderate natural light',
      overhead_beams_detected: false, beam_count: 0,
      electrical_points_visible: 2, electrical_point_positions: ['near_door'],
      existing_furniture: [], wall_colours_existing: ['white'],
      flooring_type: 'tile', flooring_colour: 'beige', ceiling_colour: 'white',
      wall_condition: 'good', style_detected: ['contemporary_indian'],
      vastu_observations: { sleeping_head_direction_visible: 'unknown', mirror_facing_bed: false }
    }
  };
}


// ── ANALYZE MASTERPLAN ───────────────────────────────────────────────────────
async function handleMasterplan(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set' });

  const { imageBase64, mimeType } = await req.json();
  if (!imageBase64) return jsonRes({ ok:false, error:'imageBase64 required' }, 400);

  // Validate the base64 isn't empty
  if (imageBase64.length < 100) return jsonRes({ plan_identified:false, error:'image_too_small' });

  const system = 'You are an expert architect. You ONLY respond with valid JSON. Never use markdown. Never add explanation. Only output the JSON object.';

  const prompt = `Look at this floor plan image carefully.

If it IS a floor plan showing rooms, return this JSON with actual values observed:
{"plan_identified":true,"direction_confidence":"high","direction_clarity_note":null,"building":{"total_sqft":1200,"bhk_type":"2BHK"},"orientation":{"north_direction":"top","north_source":"compass_rose","main_entrance_direction":"east"},"rooms":[{"name":"master bedroom","compass_zone":"SW","approximate_sqft":180},{"name":"kitchen","compass_zone":"SE","approximate_sqft":90},{"name":"living room","compass_zone":"N","approximate_sqft":220}]}

If it is NOT a floor plan, return:
{"plan_identified":false,"error":"not_a_floorplan"}

Rules:
- direction_confidence: "high" only if you can see a compass rose or north arrow. "medium" if you can infer from labels. "low" if completely unknown.
- direction_clarity_note: null if high confidence. A one-sentence explanation if medium or low.
- north_source: one of "compass_rose", "north_arrow", "label_inference", "unknown"
- compass_zone: one of N, NE, E, SE, S, SW, W, NW
- List every room you can identify in the rooms array
- Replace all example values with what you actually see in this image

Output ONLY the JSON. Nothing else.`;

  try {
    const reply = await claude(env, [{
      role:'user',
      content:[
        { type:'image', source:{ type:'base64', media_type: mimeType || 'image/jpeg', data:imageBase64 } },
        { type:'text', text:prompt }
      ]
    }], system, 1000);

    if (!reply) return jsonRes({ plan_identified:false, error:'empty_response' });

    const parsed = parseJSON(reply);

    // If parsing failed, return a useful error
    if (parsed.error === 'parse_failed') {
      return jsonRes({
        plan_identified: false,
        error: 'could_not_parse',
        raw: parsed.raw
      });
    }

    return jsonRes({ ok:true, ...parsed });

  } catch(e) {
    console.error('Masterplan error:', e.message);
    return jsonRes({
      ok: false,
      plan_identified: false,
      error: e.message.includes('image') || e.message.includes('size') || e.message.includes('large')
        ? 'image_too_large — please use a smaller floor plan image (under 2MB)'
        : e.message
    }, 500);
  }
}

// ── GENERATE RENDER ─────────────────────────────────────────────────────────
// Uses Stability AI SD3 for txt2img (no photo) or img2img (with user's photo).
// Multipart form-data is built manually — avoids Cloudflare FormData/Blob issues.
async function handleRender(req, env) {
  if (!env.STABILITY_API_KEY) {
    return jsonRes({ ok:false, error:'STABILITY_API_KEY not set. Go to: Cloudflare → griha-worker → Settings → Variables and Secrets → Add STABILITY_API_KEY' }, 503);
  }

  let body;
  try { body = await req.json(); } catch(e) { return jsonRes({ ok:false, error:'Invalid request body' }, 400); }

  const { design_style_id, palette_id, room_type, roomImageBase64 } = body;

  const STYLES = {
    contemporary_indian:  'contemporary Indian interior, warm terracotta accent wall, kaolin clay white walls, sheesham wood furniture, brass pendant light, handloom textiles, indoor plants, warm amber lighting',
    minimalist_modern:    'minimalist modern interior, pure linen white walls, smooth white ceiling, large-format light grey porcelain floor, clean-lined furniture, recessed LED lighting, Scandinavian simplicity',
    traditional_heritage: 'traditional Indian heritage interior, deep ochre and burgundy walls, ornate plaster ceiling with gold detail, dark teak herringbone floor, antique brass chandelier, carved wooden furniture',
    boho_chic:            'boho chic interior, sage green walls, raw plaster feature wall, terracotta encaustic cement tiles, macrame wall hanging, rattan furniture, layered dhurrie rug, Edison bulb pendants',
    industrial_modern:    'industrial modern interior, exposed raw concrete walls, polished concrete floor, anthracite ceiling, exposed brick feature wall, minimal steel furniture',
    art_deco_indian:      'Art Deco Indian interior, deep teal walls with gold geometric border, ornate cream plaster ceiling, black and gold marble floor, antique brass accents',
    japandi:              'Japandi interior, warm greige washi walls, pale oak ceiling beams, wide-plank light ash floor, wabi-sabi plaster finish, soft diffused natural light',
    coastal_indian:       'coastal Indian interior, aquamarine limewash walls, whitewashed wooden ceiling, pale weathered teak floor, natural rope texture, light linen curtains',
  };
  const PALETTES = {
    warm_earthen:     'colour palette warm terracotta, tawny brown, kaolin cream',
    sage_serenity:    'colour palette sage green, pale moss, crisp white',
    terracotta_dawn:  'colour palette burnt terracotta, brick red, warm peach',
    cloud_white:      'colour palette pure white, warm ivory, soft greige',
    monsoon_blue:     'colour palette cerulean blue, deep navy, arctic white',
    golden_hour:      'colour palette warm gold, amber honey, champagne cream',
    forest_deep:      'colour palette forest green, dark fern, pale sage',
    blush_rose:       'colour palette dusty rose, muted blush, warm cream',
    midnight_charcoal:'colour palette warm charcoal, dark slate, warm grey',
    coastal_sand:     'colour palette coastal sand, bleached driftwood, sea foam',
  };

  const style   = STYLES[design_style_id] || STYLES.contemporary_indian;
  const palette = PALETTES[palette_id]    || PALETTES.warm_earthen;
  const room    = (room_type || 'room').replace(/_/g, ' ');

  const prompt    = `Photorealistic professional interior design photograph of an Indian ${room}. ${style}. ${palette}. Ultra realistic. Soft natural lighting. Wide angle view. No people. 8K quality.`;
  const negPrompt = 'cartoon, anime, sketch, watermark, text, blurry, distorted, low quality, people, person, human';

  try {
    const boundary = '----StabilityBoundary' + Math.random().toString(36).slice(2);
    let formParts  = '';

    const addField = (name, value) => {
      formParts += `--${boundary}
Content-Disposition: form-data; name="${name}"

${value}
`;
    };

    if (roomImageBase64) {
      // IMG2IMG — user's photo as the base
      addField('mode',          'image-to-image');
      addField('prompt',        prompt);
      addField('negative_prompt', negPrompt);
      addField('strength',      '0.45');
      addField('output_format', 'png');
      addField('model',         'sd3-large-turbo');

      // Append the image as binary file part
      const imageData = Uint8Array.from(atob(roomImageBase64), c => c.charCodeAt(0));
      const fileHeader = `--${boundary}
Content-Disposition: form-data; name="image"; filename="room.jpg"
Content-Type: image/jpeg

`;
      const fileFooter = `
--${boundary}--
`;

      // Build final body as Uint8Array
      const enc        = new TextEncoder();
      const headerBytes = enc.encode(formParts + fileHeader);
      const footerBytes = enc.encode(fileFooter);
      const total       = new Uint8Array(headerBytes.length + imageData.length + footerBytes.length);
      total.set(headerBytes, 0);
      total.set(imageData,   headerBytes.length);
      total.set(footerBytes, headerBytes.length + imageData.length);

      const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.STABILITY_API_KEY}`,
          'Accept':        'image/*',
          'Content-Type':  `multipart/form-data; boundary=${boundary}`,
        },
        body: total,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.status);
        return jsonRes({ ok:false, error:`Stability AI ${response.status}: ${errText}` }, 502);
      }

      const imgBuffer  = await response.arrayBuffer();
      const imgBytes   = new Uint8Array(imgBuffer);
      let binary       = '';
      for (let i = 0; i < imgBytes.length; i += 8192) {
        binary += String.fromCharCode(...imgBytes.subarray(i, i + 8192));
      }
      return jsonRes({ ok:true, image_base64: btoa(binary), mime_type:'image/png', mode:'img2img' });

    } else {
      // TXT2IMG — no photo, generate from description
      addField('mode',          'text-to-image');
      addField('prompt',        prompt);
      addField('negative_prompt', negPrompt);
      addField('aspect_ratio',  '16:9');
      addField('output_format', 'png');
      addField('model',         'sd3-large-turbo');
      formParts += `--${boundary}--
`;

      const response = await fetch('https://api.stability.ai/v2beta/stable-image/generate/sd3', {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.STABILITY_API_KEY}`,
          'Accept':        'image/*',
          'Content-Type':  `multipart/form-data; boundary=${boundary}`,
        },
        body: formParts,
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => response.status);
        return jsonRes({ ok:false, error:`Stability AI ${response.status}: ${errText}` }, 502);
      }

      const imgBuffer = await response.arrayBuffer();
      const imgBytes  = new Uint8Array(imgBuffer);
      let binary      = '';
      for (let i = 0; i < imgBytes.length; i += 8192) {
        binary += String.fromCharCode(...imgBytes.subarray(i, i + 8192));
      }
      return jsonRes({ ok:true, image_base64: btoa(binary), mime_type:'image/png', mode:'txt2img' });
    }

  } catch(e) {
    console.error('Render error:', e.message);
    return jsonRes({ ok:false, error:`Render failed: ${e.message}` }, 500);
  }
}


// ── CHAT ─────────────────────────────────────────────────────────────────────
async function handleChat(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set in Worker secrets.' });

  let body;
  try { body = await req.json(); } catch(e) { return jsonRes({ ok:false, error:'Invalid JSON body' }, 400); }

  const { userMessage, currentAnalysis, conversationHistory=[] } = body;
  if (!userMessage) return jsonRes({ ok:false, error:'userMessage required' }, 400);

  const system = `You are Griha, an AI interior design assistant specialising in Vastu-compliant Indian homes.
Help users with surface design (walls, paint, ceiling, flooring), Vastu compliance, and colour recommendations.
Be specific — mention Asian Paints or Berger paint codes when relevant. Keep responses to 3-4 sentences.`;

  // Compact context string
  const context = currentAnalysis
    ? `[Room: ${currentAnalysis.room_type||'unknown'} | Zone: ${currentAnalysis.zone||'unknown'} | Vastu score: ${currentAnalysis.vastu_score||'?'}/100 | Style: ${currentAnalysis.selected_style||'not set'}]`
    : '';

  const messages = [
    ...conversationHistory.slice(-8),
    { role:'user', content: context ? `${context}\n\nQuestion: ${userMessage}` : userMessage }
  ];

  const reply = await claude(env, messages, system, 400);
  if (!reply) return jsonRes({ ok:false, error:'Empty response from AI. Try again.' });

  return jsonRes({ ok:true, reply });
}

// ── HELPERS ───────────────────────────────────────────────────────────────────
async function claude(env, messages, system=null, max_tokens=1024) {
  const body = { model:ANTHROPIC_MODEL, max_tokens, messages };
  if (system) body.system = system;

  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: { 'Content-Type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body: JSON.stringify(body)
  });

  if (!r.ok) {
    const err = await r.json().catch(()=>({error:{message:`HTTP ${r.status}`}}));
    throw new Error(err.error?.message || `Anthropic returned ${r.status}`);
  }

  const d = await r.json();
  return d.content?.[0]?.text || '';
}

function parseJSON(text) {
  if (!text) return { error:'empty' };
  // Strip markdown fences
  const c = text.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(c); } catch {}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return { error:'parse_failed', raw:text.slice(0,100) };
}
