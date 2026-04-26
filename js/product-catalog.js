/**
 * GRIHA PRODUCT CATALOG
 * =====================
 * Fetches and filters product recommendations with affiliate links.
 *
 * TO IMPROVE THIS MODULE:
 *   — Connect Airtable: fill in AIRTABLE_CONFIG below.
 *   — Swap to a different data source (Notion, Google Sheets, custom API)
 *     by implementing a new DataSource class and passing it in config.
 *   — Add new filter fields (price range, material, dimensions) by
 *     adding them to the filter() method below.
 *   — NEVER hardcode affiliate tags here — keep them in Airtable or
 *     the SAMPLE_PRODUCTS array so they can be updated without code changes.
 *
 * DATA SOURCE PRIORITY:
 *   1. Airtable (if configured) — live, your real catalog
 *   2. Static JSON fallback — sample data for testing/demo
 */

// ─── CONFIGURE THIS ───────────────────────────────────────────────────────────
const AIRTABLE_CONFIG = {
  enabled:   false,                  // Set to true when you have your base set up
  apiKey:    'YOUR_AIRTABLE_TOKEN',  // Personal Access Token from airtable.com/account
  baseId:    'appXXXXXXXXXXXXXX',   // From your Airtable base URL
  tableId:   'tblXXXXXXXXXXXXXX',  // Table name or ID for Products table
};

// Your affiliate tracking tags — update here whenever they change
const AFFILIATE_TAGS = {
  amazon:      'griha-21',    // Format: ?tag=griha-21
  pepperfry:   'griha_pf',   // Admitad tracking param
  urban_ladder:'griha_ul',
  ikea:        'griha_ik',
};
// ─────────────────────────────────────────────────────────────────────────────

export class ProductCatalog {
  constructor() {
    this._cache = null;
    this._cacheTime = null;
    this._cacheTTL  = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Get product recommendations for a room analysis result.
   *
   * @param {object} filters
   * @param {string}   filters.room_type    - e.g. "master_bedroom"
   * @param {string}   filters.vastu_zone   - e.g. "SW"
   * @param {string[]} filters.style_tags   - e.g. ["modern", "minimalist"]
   * @param {number}   [filters.max_price]  - optional price ceiling in INR
   * @param {number}   [filters.max_results]- default 6
   * @returns {Promise<Product[]>}
   */
  async getRecommendations(filters = {}) {
    const { room_type, vastu_zone, style_tags = [], max_price, max_results = 6 } = filters;

    const all = await this._loadProducts();

    let filtered = all.filter(product => {
      // Match room type
      const roomMatch = product.room_types.includes('ALL') || product.room_types.includes(room_type);
      if (!roomMatch) return false;

      // Match Vastu zone (optional — if product has zone tags)
      if (vastu_zone && product.vastu_zones && product.vastu_zones.length > 0) {
        const zoneMatch = product.vastu_zones.includes('ALL') || product.vastu_zones.includes(vastu_zone);
        if (!zoneMatch) return false;
      }

      // Price filter
      if (max_price && product.price_inr > max_price) return false;

      // In stock
      if (product.in_stock === false) return false;

      return true;
    });

    // Score by style tag match
    filtered = filtered.map(p => ({
      ...p,
      _relevance_score: this._scoreProduct(p, style_tags, vastu_zone)
    })).sort((a, b) => b._relevance_score - a._relevance_score);

    // Inject affiliate links
    const results = filtered.slice(0, max_results).map(p => {
      const { _relevance_score, ...clean } = p;
      return { ...clean, affiliate_url: this._buildAffiliateUrl(clean) };
    });

    return results;
  }

  /**
   * Get a specific product by ID.
   */
  async getById(id) {
    const all = await this._loadProducts();
    const product = all.find(p => p.id === id);
    return product ? { ...product, affiliate_url: this._buildAffiliateUrl(product) } : null;
  }

  // ─── Private: Data loading ─────────────────────────────────────────────────

  async _loadProducts() {
    // Return cached if fresh
    if (this._cache && (Date.now() - this._cacheTime) < this._cacheTTL) {
      return this._cache;
    }

    let products;

    if (AIRTABLE_CONFIG.enabled) {
      try {
        products = await this._fetchFromAirtable();
      } catch (err) {
        console.warn('Airtable fetch failed, falling back to sample data:', err.message);
        products = SAMPLE_PRODUCTS;
      }
    } else {
      products = SAMPLE_PRODUCTS;
    }

    this._cache     = products;
    this._cacheTime = Date.now();
    return products;
  }

  async _fetchFromAirtable() {
    // Airtable REST API — maps field names from your Airtable schema
    // IMPORTANT: Field names here must match your Airtable column names exactly
    const url = `https://api.airtable.com/v0/${AIRTABLE_CONFIG.baseId}/${AIRTABLE_CONFIG.tableId}`;
    const res = await fetch(`${url}?filterByFormula={In Stock}=TRUE()`, {
      headers: { 'Authorization': `Bearer ${AIRTABLE_CONFIG.apiKey}` }
    });

    if (!res.ok) throw new Error(`Airtable returned ${res.status}`);
    const data = await res.json();

    // Map Airtable record format → our Product format
    return data.records.map(r => ({
      id:          r.id,
      name:        r.fields['Product name']    || '',
      brand:       r.fields['Brand']           || '',
      category:    r.fields['Sub-category']    || '',
      room_types:  r.fields['Room type']       || [],
      vastu_zones: r.fields['Vastu direction'] || [],
      style_tags:  r.fields['Style tags']      || [],
      price_inr:   r.fields['Price (INR)']     || 0,
      platform:    r.fields['Affiliate platform'] || '',
      base_url:    r.fields['Affiliate link']  || '',
      vastu_note:  r.fields['Vastu notes']     || '',
      description: r.fields['AI description'] || '',
      rating:      r.fields['Rating']          || null,
      in_stock:    r.fields['In stock'] !== false,
      emoji:       '🛋', // Default
    }));
  }

  // ─── Private: Scoring ──────────────────────────────────────────────────────

  _scoreProduct(product, style_tags, zone) {
    let score = 0;
    if (zone && product.vastu_zones?.includes(zone)) score += 5;
    style_tags.forEach(tag => { if (product.style_tags?.includes(tag)) score += 2; });
    if (product.rating) score += product.rating * 0.5;
    return score;
  }

  // ─── Private: Affiliate URL builder ───────────────────────────────────────

  /**
   * Builds the tracked affiliate URL from the base product URL.
   * GUARDRAIL: If no base_url exists, returns empty string — never fabricates a URL.
   */
  _buildAffiliateUrl(product) {
    if (!product.base_url) return '';
    const url = product.base_url.trim();

    switch ((product.platform || '').toLowerCase()) {
      case 'amazon':
      case 'amazon india':
        return url.includes('?')
          ? `${url}&tag=${AFFILIATE_TAGS.amazon}`
          : `${url}?tag=${AFFILIATE_TAGS.amazon}`;

      case 'pepperfry':
        return `${url}${url.includes('?') ? '&' : '?'}utm_source=${AFFILIATE_TAGS.pepperfry}`;

      case 'urban ladder':
        return `${url}${url.includes('?') ? '&' : '?'}utm_source=${AFFILIATE_TAGS.urban_ladder}`;

      case 'ikea':
      case 'ikea india':
        return `${url}${url.includes('?') ? '&' : '?'}ref=${AFFILIATE_TAGS.ikea}`;

      default:
        return url;
    }
  }
}

// ─── SAMPLE PRODUCTS ──────────────────────────────────────────────────────────
// These are used when Airtable is not configured.
// Replace with your real catalog by enabling Airtable above.
// TO ADD: copy a product object, change the values, give it a new id.

const SAMPLE_PRODUCTS = [
  // ── Master bedroom ──
  {
    id: 'SP-001', name: 'Scandinavian Sheesham Bed, Queen', brand: 'Woodsworth',
    category: 'Bed', emoji: '🛏',
    room_types: ['master_bedroom', 'bedroom'],
    vastu_zones: ['SW', 'S'],
    style_tags: ['contemporary_indian', 'minimalist', 'wooden'],
    price_inr: 28500, platform: 'Pepperfry',
    base_url: 'https://www.pepperfry.com/site/woodsworth-sheesham-queen-bed.html',
    vastu_note: 'Solid sheesham wood grounds the SW zone earth energy. Position with head pointing south.',
    description: 'Crafted from solid sheesham (Indian rosewood), this queen bed brings warmth and natural grain to your master bedroom.',
    rating: 4.5, in_stock: true
  },
  {
    id: 'SP-002', name: 'HEMNES Bed Frame, White Stain', brand: 'IKEA',
    category: 'Bed', emoji: '🛏',
    room_types: ['master_bedroom', 'bedroom', 'guest_bedroom'],
    vastu_zones: ['ALL'],
    style_tags: ['minimalist', 'modern', 'scandinavian'],
    price_inr: 22990, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/dp/HEMNES-BED-IKEA',
    vastu_note: 'Clean lines and light finish — versatile for all zones. Place in SW corner for best Vastu alignment.',
    description: 'Simple, durable pine construction with a light stain finish. Includes slatted bed base for ventilation.',
    rating: 4.3, in_stock: true
  },
  {
    id: 'SP-003', name: 'HEKTAR Floor Lamp with LED Bulb', brand: 'IKEA',
    category: 'Lighting', emoji: '💡',
    room_types: ['master_bedroom', 'bedroom', 'living_room'],
    vastu_zones: ['SE', 'E'],
    style_tags: ['modern', 'minimalist', 'industrial'],
    price_inr: 3999, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/dp/HEKTAR-FLOOR-LAMP-IKEA',
    vastu_note: 'Place in the SE corner of the bedroom. The SE Agni zone benefits from warm artificial light.',
    description: 'Adjustable floor lamp with LED bulb included. The warm white light creates a calming bedroom atmosphere.',
    rating: 4.4, in_stock: true
  },
  {
    id: 'SP-004', name: 'Macramé Wall Hanging with Feathers', brand: 'Cocobolo Décor',
    category: 'Wall Decor', emoji: '🎨',
    room_types: ['master_bedroom', 'bedroom', 'living_room'],
    vastu_zones: ['N', 'NE', 'E'],
    style_tags: ['boho', 'contemporary_indian', 'handcrafted'],
    price_inr: 1299, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/macrame-wall-hanging',
    vastu_note: 'Hang on the north or east wall. Avoid south wall for decorative items in bedrooms.',
    description: 'Handwoven cotton macramé with natural feathers. Made by Indian artisans.',
    rating: 4.2, in_stock: true
  },
  // ── Living room ──
  {
    id: 'SP-005', name: 'Kivik 3-Seat Sofa, Beige', brand: 'IKEA',
    category: 'Sofa', emoji: '🛋',
    room_types: ['living_room', 'drawing_room'],
    vastu_zones: ['SW', 'S', 'W'],
    style_tags: ['minimalist', 'modern', 'scandinavian'],
    price_inr: 42990, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/dp/KIVIK-SOFA-IKEA',
    vastu_note: 'Position along the south or west wall of the living room. The SW zone sofa placement is ideal per Vastu.',
    description: 'Generous seating depth, easy-to-clean cover. Available in multiple upholstery options.',
    rating: 4.5, in_stock: true
  },
  {
    id: 'SP-006', name: 'Mango Wood Coffee Table, Natural', brand: 'Furncraft',
    category: 'Table', emoji: '🪵',
    room_types: ['living_room', 'drawing_room'],
    vastu_zones: ['ALL'],
    style_tags: ['contemporary_indian', 'traditional', 'wooden'],
    price_inr: 12500, platform: 'Pepperfry',
    base_url: 'https://www.pepperfry.com/mango-wood-coffee-table.html',
    vastu_note: 'Solid mango wood supports the earth element. Centre placement in the living room is acceptable per Vastu.',
    description: 'Solid mango wood with a natural finish. Handcrafted in Rajasthan.',
    rating: 4.3, in_stock: true
  },
  {
    id: 'SP-007', name: 'Boston Fabric 3-Seater Sofa', brand: 'Urban Ladder',
    category: 'Sofa', emoji: '🛋',
    room_types: ['living_room'],
    vastu_zones: ['SW', 'S'],
    style_tags: ['modern', 'contemporary', 'premium'],
    price_inr: 38999, platform: 'Urban Ladder',
    base_url: 'https://www.urbanladder.com/boston-3-seater-sofa',
    vastu_note: 'Solid frame with premium fabric. South wall placement aligns with Vastu\'s heavy furniture principle.',
    description: 'Kiln-dried solid wood frame with high-density foam. Stain-resistant polyester fabric.',
    rating: 4.6, in_stock: true
  },
  // ── Kitchen / dining ──
  {
    id: 'SP-008', name: 'LISABO Dining Table, Ash Veneer', brand: 'IKEA',
    category: 'Dining Table', emoji: '🍽',
    room_types: ['kitchen', 'dining_room'],
    vastu_zones: ['SE', 'E', 'W'],
    style_tags: ['minimalist', 'modern', 'scandinavian'],
    price_inr: 18990, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/dp/LISABO-TABLE-IKEA',
    vastu_note: 'Place the dining table in the SE or east zone. The family should face east while eating.',
    description: 'Sturdy ash veneer dining table. Easy to assemble. Seats 4 comfortably.',
    rating: 4.2, in_stock: true
  },
  // ── Plants / decor ──
  {
    id: 'SP-009', name: 'Boho Macramé Planter with Stand', brand: 'Elista',
    category: 'Planter', emoji: '🪴',
    room_types: ['ALL'],
    vastu_zones: ['NE', 'N', 'E'],
    style_tags: ['boho', 'contemporary_indian', 'handcrafted'],
    price_inr: 1800, platform: 'Urban Ladder',
    base_url: 'https://www.urbanladder.com/macrame-planter-stand',
    vastu_note: 'Place in the NE corner. Plants in the NE zone attract positive energy. Avoid plants in SW bedrooms.',
    description: 'Handwoven macramé planter with a 5-foot wooden stand. Holds pots up to 6 inches.',
    rating: 4.4, in_stock: true
  },
  {
    id: 'SP-010', name: 'FEJKA Artificial Potted Plant', brand: 'IKEA',
    category: 'Plant', emoji: '🌿',
    room_types: ['ALL'],
    vastu_zones: ['NE', 'N', 'E', 'NW'],
    style_tags: ['minimalist', 'modern'],
    price_inr: 699, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/dp/FEJKA-PLANT-IKEA',
    vastu_note: 'Low maintenance alternative to live plants. Place in north or east corners.',
    description: 'Lifelike monstera plant that needs zero maintenance — ideal for low-light homes.',
    rating: 4.0, in_stock: true
  },
  // ── Storage ──
  {
    id: 'SP-011', name: 'PAX Wardrobe, White', brand: 'IKEA',
    category: 'Wardrobe', emoji: '🚪',
    room_types: ['master_bedroom', 'bedroom'],
    vastu_zones: ['SW', 'S', 'W'],
    style_tags: ['minimalist', 'modern', 'scandinavian'],
    price_inr: 35990, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/dp/PAX-WARDROBE-IKEA',
    vastu_note: 'Place wardrobes along the south or west walls — never in the NE corner of the bedroom.',
    description: 'Modular wardrobe system with customisable interior. White finish with soft-close hinges.',
    rating: 4.5, in_stock: true
  },
  // ── Rugs ──
  {
    id: 'SP-012', name: 'Handloom Cotton Dhurrie Rug, 5x8', brand: 'Fabindia',
    category: 'Rug', emoji: '🔲',
    room_types: ['living_room', 'master_bedroom'],
    vastu_zones: ['ALL'],
    style_tags: ['traditional', 'contemporary_indian', 'handcrafted'],
    price_inr: 4500, platform: 'Amazon India',
    base_url: 'https://www.amazon.in/fabindia-dhurrie-rug',
    vastu_note: 'Handwoven cotton rugs from Indian craft traditions. Place centrally — avoid blocking doorways.',
    description: 'Flat-weave dhurrie in traditional geometric patterns. Handloom cotton, washable.',
    rating: 4.3, in_stock: true
  }
];
