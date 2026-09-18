// Joins the flat catalog tables into sellable items + fast lookup maps.

export function imageUrl(img, w = 400) {
  if (!img) return "";
  if (img.startsWith("drive:")) return `https://lh3.googleusercontent.com/d/${img.slice(6)}=w${w}`;
  return img;
}

export function buildCatalog(cat) {
  const empty = { items: [], byVariant: new Map(), byBarcode: new Map(), products: [], productById: new Map(), brands: [], categories: [], brandById: new Map(), catById: new Map() };
  if (!cat) return empty;
  const brandById = new Map(cat.brands.map((b) => [b.id, b]));
  const catById = new Map(cat.categories.map((c) => [c.id, c]));
  const productById = new Map(cat.products.map((p) => [p.id, p]));
  const items = [];
  const byVariant = new Map();
  const byBarcode = new Map();
  for (const v of cat.variants) {
    const p = productById.get(v.product_id);
    if (!p) continue;
    const brand = brandById.get(p.brand_id);
    const category = catById.get(p.category_id);
    const it = {
      id: v.id,
      product_id: p.id,
      name: p.name,
      brand: brand ? brand.name : "",
      brand_id: p.brand_id,
      category: category ? category.name : "",
      category_id: p.category_id,
      gender: p.gender,
      size: v.size_label,
      size_ml: v.size_ml,
      unit: v.unit,
      loose: p.sale_type === "loose" || v.unit === "ml",
      price: v.sell_price,
      mrp: v.mrp,
      cost: v.avg_cost,
      stock: v.stock_qty, // at the branch this phone is working at
      stockBy: v.stock_by_branch || {}, // {branch_id: qty} for every branch
      reorder: v.reorder_level,
      barcode: v.barcode,
      sku: v.sku,
      gst: p.gst_rate,
      hsn: p.hsn,
      image: p.image,
      active: !!(v.active && p.active),
      search: `${p.name} ${brand ? brand.name : ""} ${v.size_label} ${v.barcode} ${v.sku} ${category ? category.name : ""}`.toLowerCase(),
    };
    items.push(it);
    byVariant.set(v.id, it);
    if (v.barcode) byBarcode.set(v.barcode, it);
  }
  items.sort((a, b) => a.name.localeCompare(b.name) || a.size_ml - b.size_ml);
  return {
    items,
    byVariant,
    byBarcode,
    products: cat.products,
    productById,
    brands: [...cat.brands].sort((a, b) => a.name.localeCompare(b.name)),
    categories: [...cat.categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name)),
    brandById,
    catById,
  };
}

export function searchItems(items, q) {
  const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!words.length) return items;
  return items.filter((it) => words.every((w) => it.search.includes(w)));
}

export function lookupBarcode(cat, code) {
  const c = String(code || "").replace(/\s+/g, "");
  return cat.byBarcode.get(c) || null;
}
