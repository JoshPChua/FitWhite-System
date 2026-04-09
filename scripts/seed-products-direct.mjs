/**
 * FitWhite — Seed Products + Inventory via direct PostgreSQL
 */
import pg from 'pg';
const { Client } = pg;

const client = new Client({
  host: 'db.cdtmufbsexzlgucmlols.supabase.co',
  port: 5432,
  database: 'postgres',
  user: 'postgres',
  password: 'Fitwhite2026!',
  ssl: { rejectUnauthorized: false },
});

const PRODUCTS = [
  { name: 'Stemcell Booster',     category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-STEMCELL',    qty: 200, low: 20 },
  { name: 'Whitening Booster',    category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-WHITENING',   qty: 200, low: 20 },
  { name: 'Placenta Booster',     category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-PLACENTA',    qty: 200, low: 20 },
  { name: 'Collagen Booster',     category: 'IV Boosters',  price: 500,  unit: 'vial', sku: 'IV-COLLAGEN',    qty: 200, low: 20 },
  { name: 'Vitamin C Booster',    category: 'IV Boosters',  price: 300,  unit: 'vial', sku: 'IV-VITC',        qty: 300, low: 30 },
  { name: 'Vitamin B Complex',    category: 'IV Boosters',  price: 300,  unit: 'vial', sku: 'IV-VITB',        qty: 300, low: 30 },
  { name: 'Calamansi Soap',       category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-CALAMANSI', qty: 100, low: 10 },
  { name: 'Carrot Soap',          category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-CARROT',    qty: 100, low: 10 },
  { name: 'Collagen Soap',        category: 'Soaps',        price: 180,  unit: 'bar',  sku: 'SOAP-COLLAGEN',  qty: 100, low: 10 },
  { name: 'Glutathione Soap',     category: 'Soaps',        price: 200,  unit: 'bar',  sku: 'SOAP-GLUTA',     qty: 100, low: 10 },
  { name: 'Kojic Soap',           category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-KOJIC',     qty: 100, low: 10 },
  { name: 'Lemon Soap',           category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-LEMON',     qty: 100, low: 10 },
  { name: 'Oatmeal Soap',         category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-OATMEAL',   qty: 100, low: 10 },
  { name: 'Placenta Soap',        category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-PLACENTA',  qty: 100, low: 10 },
  { name: 'Tomato Soap',          category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-TOMATO',    qty: 100, low: 10 },
  { name: 'Glutamansi Soap',      category: 'Soaps',        price: 180,  unit: 'bar',  sku: 'SOAP-GLUTAMANSI',qty: 100, low: 10 },
  { name: 'Niacinamide Soap',     category: 'Soaps',        price: 180,  unit: 'bar',  sku: 'SOAP-NIACINAMIDE',qty:100, low: 10 },
  { name: 'Sugarcane Soap',       category: 'Soaps',        price: 150,  unit: 'bar',  sku: 'SOAP-SUGARCANE', qty: 100, low: 10 },
  { name: 'Collagen Elastin Cream',category:'Creams',       price: 350,  unit: 'bottle',sku:'CRM-COL-ELASTIN', qty: 50, low: 5 },
  { name: 'Mela White Cream',     category: 'Creams',       price: 400,  unit: 'bottle',sku:'CRM-MELA-WHITE',  qty: 50, low: 5 },
  { name: 'Stretchmark Cream',    category: 'Creams',       price: 450,  unit: 'bottle',sku:'CRM-STRETCHMARK', qty: 50, low: 5 },
  { name: 'Sunblock Beige Cream', category: 'Creams',       price: 350,  unit: 'bottle',sku:'CRM-SUNBLOCK-BG', qty: 80, low: 10 },
  { name: 'Underarm Cream',       category: 'Creams',       price: 300,  unit: 'bottle',sku:'CRM-UNDERARM',    qty: 80, low: 10 },
  { name: 'Antibacterial Cream',  category: 'Creams',       price: 200,  unit: 'tube',  sku:'CRM-ANTIBAC',     qty: 80, low: 10 },
  { name: 'CO2 Cream',            category: 'Creams',       price: 250,  unit: 'tube',  sku:'CRM-CO2',         qty: 60, low: 5 },
  { name: 'Hydrocortisone Cream', category: 'Creams',       price: 180,  unit: 'tube',  sku:'CRM-HYDROCORT',   qty: 80, low: 10 },
  { name: 'Skin Defender',        category: 'Creams',       price: 300,  unit: 'bottle',sku:'CRM-SKIN-DEF',    qty: 60, low: 5 },
  { name: 'Eyelift Cream',        category: 'Creams',       price: 500,  unit: 'bottle',sku:'CRM-EYELIFT',     qty: 50, low: 5 },
  { name: 'Sunblock Gel',         category: 'Sunblock',     price: 350,  unit: 'bottle',sku:'SBK-GEL',         qty: 80, low: 10 },
  { name: 'Sunblock SPF 70',      category: 'Sunblock',     price: 350,  unit: 'bottle',sku:'SBK-SPF70',       qty: 80, low: 10 },
  { name: 'Acne Toner',           category: 'Solutions',    price: 250,  unit: 'bottle',sku:'SOL-ACNE-TNRR',   qty: 80, low: 10 },
  { name: 'Clarifying Solution Big',  category:'Solutions', price: 400,  unit: 'bottle',sku:'SOL-CLARIFY-BIG', qty: 50, low: 5 },
  { name: 'Clarifying Solution Small',category:'Solutions', price: 250,  unit: 'bottle',sku:'SOL-CLARIFY-SM',  qty: 80, low: 10 },
  { name: 'Mela Clear Solution Big',  category:'Solutions', price: 400,  unit: 'bottle',sku:'SOL-MELA-BIG',    qty: 50, low: 5 },
  { name: 'Mela Clear Solution Small',category:'Solutions', price: 250,  unit: 'bottle',sku:'SOL-MELA-SM',     qty: 80, low: 10 },
  { name: 'Intensive',            category: 'Solutions',    price: 350,  unit: 'bottle',sku:'SOL-INTENSIVE',   qty: 60, low: 5 },
  { name: 'Instant White',        category: 'Solutions',    price: 250,  unit: 'bottle',sku:'SOL-INSTANT-WHITE',qty:80, low: 10 },
  { name: 'Hand Lotion',          category: 'Lotions',      price: 200,  unit: 'bottle',sku:'LOT-HAND',        qty: 100, low: 10 },
  { name: 'Skin Moisturizing Lotion',category:'Lotions',    price: 250,  unit: 'bottle',sku:'LOT-MOISTURIZE',  qty: 100, low: 10 },
  { name: 'Niacinamide Lotion',   category: 'Lotions',      price: 300,  unit: 'bottle',sku:'LOT-NIACINAMIDE', qty: 80,  low: 10 },
  { name: 'Glass Skin Serum',     category: 'Serums & Sets',price: 600,  unit: 'bottle',sku:'SRM-GLASS-SKIN',  qty: 50, low: 5 },
  { name: 'Glass Skin Set',       category: 'Serums & Sets',price: 2000, unit: 'set',   sku:'SET-GLASS-SKIN',  qty: 30, low: 5 },
  { name: 'Whitening Tea',        category: 'Serums & Sets',price: 350,  unit: 'box',   sku:'WTE-WHITENING',   qty: 50, low: 5 },
  { name: 'Medical Kit (Complete)',                   category:'Medical',price:500,  unit:'kit',   sku:'MED-KIT-FULL',    qty:50, low:5 },
  { name: 'Medical Kit (Mupirocin & Antibiotics)',    category:'Medical',price:350,  unit:'kit',   sku:'MED-KIT-MUPABX',  qty:60, low:5 },
  { name: 'Medical Kit (Antibiotics & Mefenamic)',    category:'Medical',price:300,  unit:'kit',   sku:'MED-KIT-ABXMEF',  qty:60, low:5 },
  { name: 'Aphrodite Softgel',                        category:'Medical',price:800,  unit:'bottle',sku:'MED-APHRODITE-SG',qty:40, low:5 },
  { name: 'Vitamin C Orals',                          category:'Medical',price:250,  unit:'bottle',sku:'MED-VITC-ORAL',   qty:80, low:10 },
  { name: 'Vitamin B Orals',                          category:'Medical',price:250,  unit:'bottle',sku:'MED-VITB-ORAL',   qty:80, low:10 },
  { name: 'Vitamin E Orals',                          category:'Medical',price:250,  unit:'bottle',sku:'MED-VITE-ORAL',   qty:80, low:10 },
  { name: 'Tea Tree Soothing Gel',                    category:'Medical',price:200,  unit:'tube',  sku:'MED-TEATREE-GEL', qty:80, low:10 },
  { name: 'Mupirocin',                                category:'Medical',price:150,  unit:'tube',  sku:'MED-MUPIROCIN',   qty:100,low:10 },
  { name: 'Etherium',                                 category:'Medical',price:250,  unit:'bottle',sku:'MED-ETHERIUM',    qty:60, low:5 },
  { name: 'Fougera',                                  category:'Medical',price:200,  unit:'tube',  sku:'MED-FOUGERA',     qty:60, low:5 },
  { name: 'Binder Corset',                            category:'Accessories',price:1500,unit:'piece',sku:'ACC-BINDER',   qty:20, low:3 },
];

async function main() {
  const sep = '═'.repeat(52);
  console.log(`\n${sep}`);
  console.log('  FitWhite — Seeding Products + Inventory');
  console.log(sep);

  await client.connect();
  console.log('\n  ✅  Connected\n');

  // Get all branches
  const { rows: branches } = await client.query(
    'SELECT id, name, code FROM branches WHERE is_active = TRUE ORDER BY name'
  );
  console.log(`📍  Found ${branches.length} branches\n`);

  let totalProducts = 0;
  let totalInventory = 0;

  for (const branch of branches) {
    console.log(`▶  Seeding: ${branch.name} (${branch.code})`);

    for (const p of PRODUCTS) {
      const branchSku = `${branch.code}-${p.sku}`;

      // Upsert product (unique on branch_id + name)
      const prodRes = await client.query(
        `INSERT INTO products (branch_id, name, category, price, unit, sku, is_active)
         VALUES ($1, $2, $3, $4, $5, $6, TRUE)
         ON CONFLICT (branch_id, name) DO UPDATE
           SET price = EXCLUDED.price, sku = EXCLUDED.sku, updated_at = NOW()
         RETURNING id`,
        [branch.id, p.name, p.category, p.price, p.unit, branchSku]
      );

      if (prodRes.rows.length === 0) continue;
      const productId = prodRes.rows[0].id;
      totalProducts++;

      // Upsert inventory
      await client.query(
        `INSERT INTO inventory (product_id, branch_id, quantity, low_stock_threshold)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (branch_id, product_id) DO UPDATE
           SET quantity = EXCLUDED.quantity, low_stock_threshold = EXCLUDED.low_stock_threshold`,
        [productId, branch.id, p.qty, p.low]
      );
      totalInventory++;
    }

    console.log(`   ✅  ${PRODUCTS.length} products + inventory`);
  }

  await client.end();

  console.log(`\n${sep}`);
  console.log(`  ✅  Products seeded!`);
  console.log(`     Products: ${totalProducts}`);
  console.log(`     Inventory records: ${totalInventory}`);
  console.log(`${sep}\n`);
}

main().catch(err => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
