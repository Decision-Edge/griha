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
  const res  = jsonRes; // alias

  if (path === '/health') return jsonRes({
    status:'ok', version:'v5',
    has_key: !!(env.ANTHROPIC_API_KEY),
    has_ai:  !!(env.AI)
  });

  if (req.method !== 'POST') return jsonRes({ error:'POST required' }, 405);

  // Debug endpoint — shows what's configured without exposing secret values
  if (path === '/debug') return jsonRes({
    has_anthropic_key: !!(env.ANTHROPIC_API_KEY),
    has_stability_key: !!(env.STABILITY_API_KEY),
    has_rate_kv:       !!(env.RATE_KV),
    version:           'v6',
    timestamp:         new Date().toISOString(),
    tip_503:           !env.STABILITY_API_KEY ? 'Add STABILITY_API_KEY in Worker Settings → Variables and Secrets' : null,
  });

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

// ── GENERATE RENDER via Stability AI SDXL ───────────────────────────────────
// Uses api.stability.ai stable-image/generate/sd3 for txt2img (no photo)
// and  api.stability.ai v1 image-to-image for img2img (with user photo).
// Both run SDXL at 1024px — far better than Cloudflare Workers AI SD v1.5.
//
// Requires: STABILITY_API_KEY secret in Worker Settings → Variables and Secrets
// Get key at: platform.stability.ai → Account → API Keys
async function handleRender(req, env) {
  // Check free tier limit first
  const ip = getClientIP(req);
  const rateCheck = await checkRateLimit(env, ip, 'render');
  if (!rateCheck.allowed) {
    return jsonRes({
      ok: false,
      limit_reached: true,
      type: 'render',
      message: 'You\'ve used your free render. Buy a credit pack to generate more room previews.',
      packs: [
        { name: 'Starter', price: 299, includes: '3 rooms + 5 renders', tag: 'starter' },
        { name: 'Full Home', price: 799, includes: 'Unlimited rooms + renders', tag: 'full_home' }
      ]
    }, 429);
  }

  if (!env.STABILITY_API_KEY) {
    return jsonRes({
      ok: false,
      error: 'STABILITY_API_KEY not set. Go to: Cloudflare → griha-worker → Settings → Variables and Secrets → Add → Name: STABILITY_API_KEY → Value: your key from platform.stability.ai'
    }, 503);
  }

  const body = await req.json().catch(() => ({}));
  const { design_style_id, palette_id, room_type, roomImageBase64, roomMimeType } = body;

  // Style prompts — describe the redesigned room interior
  const STYLES = {
    contemporary_indian:
      'contemporary Indian interior design, warm terracotta accent wall, kaolin clay white walls, polished natural stone floor, sheesham wood furniture, brass pendant light, handloom textiles, indoor plants, warm golden ambient lighting, professional interior photography',
    minimalist_modern:
      'minimalist modern interior design, pure linen white walls, smooth white ceiling, large-format light grey porcelain floor, clean-lined furniture, recessed LED lighting, Scandinavian simplicity, soft natural light, professional interior photography',
    traditional_heritage:
      'traditional Indian heritage interior design, deep ochre and burgundy walls, ornate plaster ceiling with gold border, dark teak herringbone floor, antique brass chandelier, carved wooden furniture, rich silk curtains, warm amber lighting, professional interior photography',
    boho_chic:
      'bohemian chic interior design, sage green walls, raw plaster feature wall, terracotta encaustic cement floor tiles, macrame wall hanging, rattan furniture, layered dhurrie rug, Edison bulb pendants, tropical indoor plants, professional interior photography',
    industrial_modern:
      'industrial modern interior design, exposed raw concrete walls and ceiling, polished sealed concrete floor, exposed brick feature wall, steel frame elements, warm Edison bulb lighting, professional interior photography',
    art_deco_indian:
      'Art Deco Indian interior design, deep teal walls with gold geometric stencil border, ornate cream plaster ceiling with cornice, black and gold geometric marble floor, antique brass sconce lighting, velvet upholstery, professional interior photography',
    japandi:
      'Japandi interior design, warm greige washi-texture walls, pale oak ceiling beams, wide-plank light ash wood floor, minimal furniture, wabi-sabi plaster finish, soft diffused natural light, professional interior photography',
    coastal_indian:
      'coastal Indian interior design, aquamarine limewash walls, whitewashed wooden ceiling, pale weathered teak floor, natural rope texture details, light linen curtains, soft coastal light, professional interior photography',
  };

  const PALETTES = {
    warm_earthen:     'colour palette: warm terracotta #C47040, kaolin cream #EAE1D5, teak brown #8E6D4E',
    sage_serenity:    'colour palette: sage green #779971, pale moss #B5CDAC, morning white #E8EEE6',
    terracotta_dawn:  'colour palette: burnt terracotta #9A4820, brick spice red, warm peach #F5ECE1',
    cloud_white:      'colour palette: pure linen white #F5F0E8, warm ivory #EDE8DC, soft greige #C8BC9F',
    monsoon_blue:     'colour palette: cerulean blue #5B8FAE, deep navy #2E5F82, arctic white #EBF0F5',
    golden_hour:      'colour palette: warm gold #B07D20, amber honey #D4960A, champagne cream #F4EAD5',
    forest_deep:      'colour palette: forest green #2B4D25, deep fern #4E7848, pale sage #E8EEE6',
    blush_rose:       'colour palette: dusty rose #D4927B, muted blush #ECC4B8, warm cream #FAF0EA',
    midnight_charcoal:'colour palette: warm charcoal #2C2C2A, dark slate #3D3D3B, warm grey #8C8C8A',
    coastal_sand:     'colour palette: coastal sand #DED3B8, bleached driftwood #B09070, sea foam #E8EDE6',
  };

  const style   = STYLES[design_style_id]  || STYLES.contemporary_indian;
  const palette = PALETTES[palette_id]     || PALETTES.warm_earthen;
  const room    = (room_type || 'room').replace(/_/g, ' ');

  const prompt     = `Photorealistic professional interior design photograph. Indian ${room}. ${style}. ${palette}. Ultra realistic. High detail. Wide angle view showing full room. No people. 8K quality.`;
  const negPrompt  = 'cartoon, anime, sketch, watermark, text, logo, blurry, distorted, low quality, ugly, deformed, people, person, human, extra limbs, painting, illustration';

  try {
    let imageBytes;
    let mode;

    if (roomImageBase64) {
      // ── IMG2IMG: Stability AI SDXL image-to-image ──────────────────────────────
      // Takes the user's actual room photo as the starting point.
      // image_strength 0.35 = preserves 65% of the original photo structure
      // (room layout, walls, windows, proportions), applies 35% style transformation.
      // Raise image_strength to reduce original photo influence.

      // Decode base64 → binary for multipart form
      // Use Stability AI v2beta stable-image API with JSON body (no FormData issues)
      const response = await fetch(
        'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${env.STABILITY_API_KEY}`,
            'Content-Type':  'application/json',
            'Accept':        'application/json',
          },
          body: JSON.stringify({
            prompt,
            negative_prompt:  negPrompt,
            image:            roomImageBase64,   // base64 string directly
            strength:         0.65,              // how much to change (0=keep original, 1=ignore)
            model:            'sd3-large',
            mode:             'image-to-image',
            output_format:    'png',
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = err.errors?.join(', ') || err.message || `Stability API ${response.status}`;
        if (response.status === 401) return jsonRes({ ok:false, error:'Invalid STABILITY_API_KEY. Go to platform.stability.ai → Account → API Keys.' });
        if (response.status === 402) return jsonRes({ ok:false, error:'No Stability AI credits. Add at platform.stability.ai → Billing.' });
        return jsonRes({ ok:false, error:`Stability API error: ${msg}` }, 502);
      }

      const data = await response.json();
      // v2beta returns { image: "<base64>", finish_reason: "SUCCESS" }
      const base64 = data.image || data.artifacts?.[0]?.base64;
      if (!base64) return jsonRes({ ok:false, error:'Stability API returned no image. Check your API key and credits.' }, 502);

      imageBytes = base64;
      mode = 'img2img';

    } else {
      // ── TXT2IMG: Stability AI Stable Image (no photo uploaded) ─────────────────
      const response = await fetch(
        'https://api.stability.ai/v2beta/stable-image/generate/sd3',
        {
          method:  'POST',
          headers: {
            'Authorization': `Bearer ${env.STABILITY_API_KEY}`,
            'Content-Type':  'application/json',
            'Accept':        'application/json',
          },
          body: JSON.stringify({
            prompt,
            negative_prompt: negPrompt,
            model:           'sd3-large',
            mode:            'text-to-image',
            aspect_ratio:    '16:9',
            output_format:   'png',
          }),
        }
      );

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        const msg = err.errors?.join(', ') || err.message || `Stability API ${response.status}`;
        if (response.status === 401) return jsonRes({ ok:false, error:'Invalid STABILITY_API_KEY. Go to platform.stability.ai → Account → API Keys.' });
        if (response.status === 402) return jsonRes({ ok:false, error:'No Stability AI credits. Add at platform.stability.ai → Billing.' });
        return jsonRes({ ok:false, error:`Stability API error: ${msg}` }, 502);
      }

      const data = await response.json();
      const base64 = data.image || data.artifacts?.[0]?.base64;
      if (!base64) return jsonRes({ ok:false, error:'Stability API returned no image.' }, 502);

      imageBytes = base64;
      mode = 'txt2img';
    }

    await consumeCredit(env, ip, 'render');
    return jsonRes({
      ok:          true,
      image_base64: imageBytes,
      mime_type:   'image/png',
      mode,
    });

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
