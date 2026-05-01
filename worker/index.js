/**
 * GRIHA AI WORKER — v7
 * Endpoints: /health /debug /validate-photo /analyze-room /analyze-masterplan /generate-render /suggest-changes
 * Secrets:   ANTHROPIC_API_KEY, STABILITY_API_KEY (optional fallback)
 * Bindings:  AI (Workers AI), RATE_KV (KV namespace)
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

// ── Rate limiting (disabled during development) ──────────────────────────────
async function checkRateLimit(env, ip, type) {
  // TODO: re-enable before launch
  return { allowed: true };
}
async function consumeCredit(env, ip, type) {
  // TODO: re-enable before launch
}

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

  if (path === '/health') return jsonRes({
    status:'ok', version:'v7',
    has_anthropic_key: !!(env.ANTHROPIC_API_KEY),
    has_stability_key: !!(env.STABILITY_API_KEY),
    has_rate_kv:       !!(env.RATE_KV),
    has_ai:            !!(env.AI),
  });

  if (path === '/debug') return jsonRes({
    has_anthropic_key: !!(env.ANTHROPIC_API_KEY),
    has_stability_key: !!(env.STABILITY_API_KEY),
    has_rate_kv:       !!(env.RATE_KV),
    has_ai_binding:    !!(env.AI),
    version: 'v7',
    notes: {
      fix_500:  !env.ANTHROPIC_API_KEY ? 'Add ANTHROPIC_API_KEY in Worker Settings → Variables and Secrets' : 'OK',
      fix_503:  !env.AI ? 'Add Workers AI binding: Settings → Bindings → Add → Workers AI → name "AI"' : 'OK',
    }
  });

  if (req.method !== 'POST') return jsonRes({ error:'POST required' }, 405);

  if (path === '/validate-photo')     return handleValidate(req, env);
  if (path === '/analyze-room')       return handleAnalyze(req, env);
  if (path === '/analyze-masterplan') return handleMasterplan(req, env);
  if (path === '/generate-render')    return handleRender(req, env);
  if (path === '/suggest-changes')    return handleChat(req, env);

  return jsonRes({ error:'Not found' }, 404);
}

// ── /validate-photo ──────────────────────────────────────────────────────────
async function handleValidate(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ is_valid_room:true, _skipped:true });
  try {
    const { imageBase64, mimeType } = await req.json();
    if (!imageBase64) return jsonRes({ is_valid_room:true, _skipped:true });
    const reply = await callClaude(env, [{
      role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text',  text:'Is this an interior room photo? Reply ONLY with JSON: {"is_valid_room":true} or {"is_valid_room":false,"reason":"..."}. No markdown.' }
      ]
    }], null, 80);
    const d = parseJSON(reply);
    if (typeof d.is_valid_room !== 'boolean') return jsonRes({ is_valid_room:true, _skipped:true });
    return jsonRes(d);
  } catch(e) { return jsonRes({ is_valid_room:true, _skipped:true }); }
}

// ── /analyze-room ─────────────────────────────────────────────────────────────
async function handleAnalyze(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set in Worker Settings → Variables and Secrets.' });

  const ip = getClientIP(req);
  try {
    const rc = await checkRateLimit(env, ip, 'analysis');
    if (!rc.allowed) return jsonRes({
      ok:false, limit_reached:true, type:'analysis',
      message:"You've used your free room analysis. Buy a credit pack to analyse more rooms.",
      packs:[
        { name:'Starter',   price:299, includes:'3 rooms + 5 renders',      tag:'starter'   },
        { name:'Full Home', price:799, includes:'Unlimited rooms + renders', tag:'full_home' }
      ]
    }, 429);
  } catch(e) {}

  try {
    const { imageBase64, mimeType, roomLabel } = await req.json();
    if (!imageBase64) return jsonRes({ ok:false, error:'No image received.' }, 400);
    if (imageBase64.length > 6_800_000) return jsonRes({ ok:false, error:'Photo too large. Please use under 3MB.' }, 413);

    const reply = await callClaude(env, [{
      role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text',  text:`Analyse this ${roomLabel||'room'} photo. Return ONLY valid JSON, no markdown:\n{"room_identified":true,"confidence":"high","observations":{"estimated_sqft":160,"ceiling_height":"standard","ceiling_type":"flat","window_count":1,"light_direction":"east","light_quality":"bright","natural_light_assessment":"Good natural light","overhead_beams_detected":false,"beam_count":0,"electrical_points_visible":2,"electrical_point_positions":["near_door","opposite_wall"],"existing_furniture":["bed","wardrobe"],"wall_colours_existing":["white"],"flooring_type":"vitrified_tile","flooring_colour":"beige","ceiling_colour":"white","wall_condition":"good","style_detected":["contemporary_indian"],"vastu_observations":{"sleeping_head_direction_visible":"unknown","mirror_facing_bed":false}}}\nReplace all values with what you actually observe.` }
      ]
    }]);

    const parsed = parseJSON(reply);
    if (!parsed.observations) return jsonRes(fallback('Parse failed'));
    try { await consumeCredit(env, ip, 'analysis'); } catch(e) {}
    return jsonRes(parsed);
  } catch(e) {
    console.error('analyzeRoom error:', e.message);
    return jsonRes(fallback(e.message));
  }
}

// ── /analyze-masterplan ───────────────────────────────────────────────────────
async function handleMasterplan(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set.' });
  try {
    const { imageBase64, mimeType } = await req.json();
    const reply = await callClaude(env, [{
      role:'user', content:[
        { type:'image', source:{ type:'base64', media_type:mimeType||'image/jpeg', data:imageBase64 } },
        { type:'text',  text:'Analyse this floor plan. Return ONLY JSON:\n{"plan_identified":true,"direction_confidence":"high","direction_clarity_note":null,"building":{"total_sqft":1200,"bhk_type":"2BHK"},"orientation":{"north_direction":"top","north_source":"compass_rose","main_entrance_direction":"east"},"rooms":[{"name":"master bedroom","compass_zone":"SW","approximate_sqft":180}]}\nIf not a floor plan: {"plan_identified":false,"error":"not_a_floorplan"}\ndirection_confidence: high=compass visible, medium=inferred, low=unknown' }
      ]
    }], 'You are an expert architect. Reply only with valid JSON.', 500);
    return jsonRes({ ok:true, ...parseJSON(reply) });
  } catch(e) { return jsonRes({ ok:false, error:e.message }, 500); }
}

// ── /generate-render — Replicate interior-design model ──────────────────────
// Uses timothybrooks/instruct-pix2pix — instruction-based image editing on Replicate.
// Preserves room structure, furniture positions, windows exactly.
// Requires: REPLICATE_API_KEY secret in Worker Settings.
// Get key at: replicate.com → Account Settings → API Tokens
async function handleRender(req, env) {
  if (!env.REPLICATE_API_KEY) {
    return jsonRes({ ok:false, error:'REPLICATE_API_KEY not set. Sign up at replicate.com → Account Settings → API Tokens → Create token → add as secret named REPLICATE_API_KEY' }, 503);
  }

  const { design_style_id, palette_id, room_type, roomImageBase64 } = await req.json().catch(()=>({}));

  const STYLE_DEFS = {
    contemporary_indian:  { wall:'Paint the walls warm terracotta orange', floor:'Replace the floor with polished beige stone tiles', ceiling:'Paint the ceiling smooth warm white' },
    minimalist_modern:    { wall:'Paint the walls pure linen white', floor:'Replace the floor with large light grey porcelain tiles', ceiling:'Paint the ceiling brilliant white' },
    traditional_heritage: { wall:'Paint the walls deep ochre yellow with a dark burgundy dado panel', floor:'Replace the floor with dark teak herringbone wood', ceiling:'Paint the ceiling cream with a gold cornice border' },
    boho_chic:            { wall:'Paint the walls sage green', floor:'Replace the floor with terracotta patterned cement tiles', ceiling:'Paint the ceiling warm white' },
    industrial_modern:    { wall:'Paint the walls raw grey concrete texture', floor:'Replace the floor with dark polished concrete', ceiling:'Paint the ceiling dark anthracite grey' },
    art_deco_indian:      { wall:'Paint the walls deep teal with a gold geometric border stencil', floor:'Replace the floor with black and gold geometric marble tiles', ceiling:'Paint the ceiling cream with an ornate gold cornice' },
    japandi:              { wall:'Paint the walls warm greige with a subtle matte texture', floor:'Replace the floor with wide plank pale ash wood', ceiling:'Paint the ceiling white with pale wood beam detail' },
    coastal_indian:       { wall:'Paint the walls aquamarine in a limewash texture', floor:'Replace the floor with pale weathered teak wood planks', ceiling:'Paint the ceiling white with whitewashed wood plank detail' },
  };

  const PALETTE_DESCS = {
    warm_earthen:'using warm terracotta and kaolin cream as the dominant colours',
    sage_serenity:'using sage green and pale moss as the dominant colours',
    terracotta_dawn:'using burnt terracotta and pale peach as the dominant colours',
    cloud_white:'using pure white and warm greige as the dominant colours',
    monsoon_blue:'using cerulean blue and arctic white as the dominant colours',
    golden_hour:'using warm gold and champagne cream as the dominant colours',
    forest_deep:'using deep forest green and pale sage as the dominant colours',
    blush_rose:'using dusty rose and warm cream as the dominant colours',
    midnight_charcoal:'using warm charcoal and grey as the dominant colours',
    coastal_sand:'using coastal sand and sea foam as the dominant colours',
  };

  const styleDef   = STYLE_DEFS[design_style_id]  || STYLE_DEFS.contemporary_indian;
  const paletteDesc = PALETTE_DESCS[palette_id]   || PALETTE_DESCS.warm_earthen;
  const imageDataUri = roomImageBase64
    ? `data:image/jpeg;base64,${roomImageBase64}`
    : null;

  if (!imageDataUri) {
    return jsonRes({ ok:false, error:'No room photo provided. Please upload a photo first.' }, 400);
  }

  try {
    // instruct-pix2pix: instruction-based image editing
    // image_guidance_scale controls how closely output follows input photo
    // Higher = stays closer to original room photo
    const instruction = [
      styleDef.wall + '.',
      styleDef.floor + '.',
      styleDef.ceiling + '.',
      `Apply ${paletteDesc}.`,
      'Keep all furniture, windows, doors and room layout exactly the same.',
    ].join(' ');

    const createRes = await fetch(
      'https://api.replicate.com/v1/models/timothybrooks/instruct-pix2pix/predictions',
      {
        method:  'POST',
        headers: {
          'Authorization': `Bearer ${env.REPLICATE_API_KEY}`,
          'Content-Type':  'application/json',
          'Prefer':        'wait=60',
        },
        body: JSON.stringify({
          input: {
            image:               imageDataUri,
            prompt:              instruction,
            negative_prompt:     'blurry, distorted, low quality, different room, different furniture, different windows, cartoon, drawing, ugly',
            num_inference_steps: 100,
            image_guidance_scale: 1.8,  // high = stays very close to original photo
            guidance_scale:       7.5,
          },
        }),
      }
    );

    if (!createRes.ok) {
      const err = await createRes.json().catch(()=>({}));
      if (createRes.status === 401) return jsonRes({ ok:false, error:'Invalid REPLICATE_API_KEY. Check at replicate.com → Account Settings → API Tokens.' });
      if (createRes.status === 402) return jsonRes({ ok:false, error:'No Replicate credits. Add billing at replicate.com → Settings → Billing.' });
      if (createRes.status === 404) return jsonRes({ ok:false, error:'Interior design model not found on Replicate. The model may have been updated.' });
      return jsonRes({ ok:false, error:`Replicate error ${createRes.status}: ${err.detail || JSON.stringify(err)}` }, 502);
    }

    const prediction = await createRes.json();

    // Check if Replicate returned result inline (Prefer: wait worked)
    let imageUrl = null;
    if (prediction.status === 'succeeded') {
      imageUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    }

    // If not done yet, poll for result
    if (!imageUrl && prediction.id) {
      for (let i = 0; i < 25; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
          headers: { 'Authorization': `Bearer ${env.REPLICATE_API_KEY}` },
        });
        const result = await pollRes.json();
        if (result.status === 'succeeded') {
          imageUrl = Array.isArray(result.output) ? result.output[0] : result.output;
          break;
        }
        if (result.status === 'failed') {
          return jsonRes({ ok:false, error:`Render failed: ${result.error || 'Model returned an error'}` }, 502);
        }
      }
    }

    if (!imageUrl) {
      return jsonRes({ ok:false, error:'Replicate timed out. The model took too long. Try again.' }, 504);
    }

    // Step 3: Fetch the generated image and convert to base64
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) return jsonRes({ ok:false, error:'Could not fetch generated image from Replicate.' }, 502);

    const imgBuf  = await imgRes.arrayBuffer();
    const imgArr  = new Uint8Array(imgBuf);
    let binary    = '';
    for (let i = 0; i < imgArr.length; i += 8192) {
      binary += String.fromCharCode(...imgArr.subarray(i, i + 8192));
    }

    return jsonRes({ ok:true, image_base64:btoa(binary), mime_type:'image/png', mode:'interior_design' });

  } catch(e) {
    console.error('Replicate render error:', e.message);
    return jsonRes({ ok:false, error:`Render failed: ${e.message}` }, 500);
  }
}


// ── /suggest-changes (chat) ───────────────────────────────────────────────────
async function handleChat(req, env) {
  if (!env.ANTHROPIC_API_KEY) return jsonRes({ ok:false, error:'ANTHROPIC_API_KEY not set.' });
  try {
    const { userMessage, currentAnalysis, conversationHistory=[] } = await req.json();
    if (!userMessage) return jsonRes({ ok:false, error:'userMessage required' }, 400);

    const ctx = currentAnalysis
      ? `[Room: ${currentAnalysis.room_type||'?'} | Zone: ${currentAnalysis.zone||'?'} | Vastu: ${currentAnalysis.vastu_score||'?'}/100 | Style: ${currentAnalysis.selected_style||'?'}]\n\n${userMessage}`
      : userMessage;

    const reply = await callClaude(env,
      [...conversationHistory.slice(-8), { role:'user', content:ctx }],
      'You are Griha, an AI interior design assistant for Indian homes. Give specific, helpful advice about Vastu compliance, wall colours, surfaces, and room design. Mention Asian Paints or Berger paint codes where relevant. Keep responses to 3-4 sentences.',
      400
    );
    return jsonRes({ ok:true, reply });
  } catch(e) {
    return jsonRes({ ok:false, error:e.message }, 500);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function callClaude(env, messages, system=null, max_tokens=1024) {
  const body = { model:MODEL, max_tokens, messages };
  if (system) body.system = system;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'x-api-key':env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01' },
    body:JSON.stringify(body),
  });
  if (!r.ok) {
    const e = await r.json().catch(()=>({}));
    throw new Error(e.error?.message || `Anthropic ${r.status}`);
  }
  const d = await r.json();
  return d.content?.[0]?.text || '';
}

function parseJSON(text) {
  if (!text) return { error:'empty' };
  const c = text.replace(/```(?:json)?\s*/gi,'').replace(/```/g,'').trim();
  try { return JSON.parse(c); } catch {}
  const m = c.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch {} }
  return { error:'parse_failed', raw:text.slice(0,100) };
}

function fallback(reason) {
  return {
    room_identified:true, confidence:'low', _fallback:true, _reason:reason,
    observations:{
      estimated_sqft:150, ceiling_height:'standard', ceiling_type:'flat',
      window_count:1, light_direction:'east', light_quality:'moderate',
      natural_light_assessment:'Moderate natural light',
      overhead_beams_detected:false, beam_count:0,
      electrical_points_visible:2, electrical_point_positions:['near_door'],
      existing_furniture:[], wall_colours_existing:['white'],
      flooring_type:'tile', flooring_colour:'beige', ceiling_colour:'white',
      wall_condition:'good', style_detected:['contemporary_indian'],
      vastu_observations:{ sleeping_head_direction_visible:'unknown', mirror_facing_bed:false }
    }
  };
}
