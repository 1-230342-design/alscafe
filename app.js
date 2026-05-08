
// ══════════════════════════════════════════════
// NHOST / HASURA CONFIGURATION
// ══════════════════════════════════════════════
const NHOST_URL = 'https://rbgpysxoiknurfioyenb.hasura.us-east-1.nhost.run/v1/graphql';
const HASURA_SECRET = 'AlsCafe@Admin2026!';

async function gql(query, variables={}) {
  try {
    const r = await fetch(NHOST_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': HASURA_SECRET
      },
      body: JSON.stringify({ query, variables })
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('[Hasura HTTP Error]', r.status, errText);
      toast('⚠️ DB Error ' + r.status + ': ' + errText.slice(0,80));
      return null;
    }
    const d = await r.json();
    if (d.errors) {
      const msg = d.errors.map(e=>e.message).join(' | ');
      console.error('[Hasura GQL Error]', msg, '\nQuery:', query, '\nVars:', JSON.stringify(variables));
      toast('⚠️ DB Error: ' + msg.slice(0,120));
      return null;
    }
    return d.data;
  } catch(e) {
    console.error('[Hasura Fetch Error]', e.message);
    toast('⚠️ DB unreachable: ' + e.message.slice(0,80));
    return null;
  }
}

async function checkNhost() {
  const dot = document.getElementById('nd'), lbl = document.getElementById('nl');
  lbl.textContent = 'Connecting...';
  // Retry up to 3 times with 2s delay
  for (let i = 0; i < 3; i++) {
    const r = await gql('{ __typename }');
    if (r) {
      dot.className = 'nhost-dot ok';
      lbl.textContent = 'Nhost connected ✓';
      return;
    }
    if (i < 2) await new Promise(res => setTimeout(res, 2000));
  }
  dot.className = 'nhost-dot err';
  lbl.textContent = 'DB unavailable';
  console.warn('[Nhost] Could not reach:', NHOST_URL);
  console.warn('[Nhost] Fix: In Nhost > Settings > Hasura, turn OFF "Configure CORS" toggle (allow all origins), then Save.');
}

// Silent version — no toast on error (used for optional tables that may not exist yet)
async function gqlSilent(query, variables={}) {
  try {
    const r = await fetch(NHOST_URL, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/json',
        'x-hasura-admin-secret': HASURA_SECRET
      },
      body: JSON.stringify({ query, variables })
    });
    if (!r.ok) return null;
    const d = await r.json();
    if (d.errors) {
      console.warn('[Hasura silent]', d.errors.map(e=>e.message).join(' | '));
      return null;
    }
    return d.data;
  } catch(e) {
    console.warn('[Hasura silent fetch]', e.message);
    return null;
  }
}
const nhostInsertOrder = o => gql(`mutation($obj:orders_insert_input!){insert_orders_one(object:$obj){id}}`,{obj:o});
const nhostUpdateStock = (id,stock) => gql(`mutation($id:String!,$s:Int!){update_inventory_by_pk(pk_columns:{id:$id},_set:{stock:$s}){id}}`,{id,s:Math.round(stock)});
const nhostInsertInv = o => gql(`mutation($obj:inventory_insert_input!){insert_inventory_one(object:$obj){id}}`,{obj:o});
const nhostUpdateInv = (id,obj) => gql(`mutation($id:String!,$obj:inventory_set_input!){update_inventory_by_pk(pk_columns:{id:$id},_set:$obj){id}}`,{id,obj});
const nhostInsertAtt = o => gql(`mutation($obj:attendance_insert_input!){insert_attendance_one(object:$obj){id}}`,{obj:o});
const nhostCompleteOrder = id => gql(`mutation($id:Int!){update_orders_by_pk(pk_columns:{id:$id},_set:{status:"Completed"}){id}}`,{id});
const nhostInsertEditReq = o => gql(`mutation($obj:attendance_edit_requests_insert_input!){insert_attendance_edit_requests_one(object:$obj){id}}`,{obj:o});
const nhostApproveEditReq = (reqId,attId,ti,to,hrs,st) => gql(
  `mutation($rid:Int!,$aid:Int!,$ti:String!,$to:String!,$hrs:String!,$st:String!){
    update_attendance_by_pk(pk_columns:{id:$aid},_set:{time_in:$ti,time_out:$to,hours:$hrs,status:$st}){id}
    update_attendance_edit_requests_by_pk(pk_columns:{id:$rid},_set:{status:"Approved"}){id}
  }`,{rid:reqId,aid:attId,ti,to,hrs,st});
const nhostRejectEditReq = reqId => gql(`mutation($id:Int!){update_attendance_edit_requests_by_pk(pk_columns:{id:$id},_set:{status:"Rejected"}){id}}`,{id:reqId});

// In-memory edit requests (also loaded from Hasura if table exists)
let editRequests = [];

async function loadFromHasura() {
  // Load inventory from Hasura (overrides local defaults if DB has data)
  const iData = await gql('{ inventory(order_by:{id:asc}) { id name category unit stock threshold last_restocked supplier notes } }');
  console.log('[Hasura] inventory:', iData);
  if (iData && iData.inventory && iData.inventory.length > 0) {
    // Reset invData to DB state grouped by category
    const freshInv = {};
    CATS.forEach(c => freshInv[c.name] = []);
    for(const i of iData.inventory){
      const cat = i.category;
      if(!freshInv[cat]) freshInv[cat] = [];
      freshInv[cat].push({
        id: i.id, name: i.name, unit: i.unit,
        stock: i.stock, threshold: i.threshold,
        lastRestocked: i.last_restocked || '--',
        supplier: i.supplier || '—', notes: i.notes || ''
      });
    }
    invData = freshInv;
    renderInv(); checkLowStock(); renderInvCats();
  }
  // Load orders from Hasura
  const oData = await gql('{ orders(order_by:{id:desc}) { id customer item amount status time } }');
  console.log('[Hasura] orders:', oData);
  if (oData && oData.orders) {
    if (oData.orders.length > 0) {
      ordersData = oData.orders.map(o => ({
        id: o.id, customer: o.customer, time: o.time || '--',
        item: o.item, amount: o.amount, status: o.status
      }));
      const maxId = Math.max(...ordersData.map(o => o.id));
      if (maxId >= orderCounter) orderCounter = maxId + 1;
      document.getElementById('cart-num').textContent = 'Order #' + orderCounter;
    } else {
      ordersData = [];
    }
    renderOrders(); renderMiniOrders();
  }
  // Load attendance from Hasura
  const aData = await gql('{ attendance(order_by:{id:desc}) { id emp_id name date time_in time_out hours status notes } }');
  console.log('[Hasura] attendance:', aData);
  if (aData && aData.attendance) {
    if (aData.attendance.length > 0) {
      attData = aData.attendance.map(a => ({
        id: a.id, empId: a.emp_id, name: a.name, date: a.date,
        timeIn: a.time_in, timeOut: a.time_out, hours: a.hours,
        status: a.status, notes: a.notes || ''
      }));
    } else {
      attData = [];
    }
    fillAttDropdown(); renderAtt();
  }
  // Load ALL edit requests from Hasura (Pending + Approved + Rejected) for full history
  // Use silent query — table may not exist yet; suppress toast if missing
  const rData = await gqlSilent('{ attendance_edit_requests(order_by:{id:desc}) { id att_id emp_id emp_name date orig_time_in orig_time_out req_time_in req_time_out reason status submitted_at } }');
  console.log('[Hasura] edit requests:', rData);
  if (rData && rData.attendance_edit_requests && rData.attendance_edit_requests.length > 0) {
    editRequests = rData.attendance_edit_requests.map(r => ({
      id: r.id, attId: r.att_id, empId: r.emp_id, empName: r.emp_name,
      date: r.date, origTimeIn: r.orig_time_in, origTimeOut: r.orig_time_out,
      reqTimeIn: r.req_time_in, reqTimeOut: r.req_time_out,
      reason: r.reason, status: r.status,
      submittedAt: r.submitted_at || '—'
    }));
    if(currentUser.access === 'Full Access') renderEditRequests();
  }
}

// ══════════════════════════════════════════════
// DATA — from als_cafe_employee_db.xlsx
//         and als_cafe_inventory_db.xlsx
// ══════════════════════════════════════════════
const DB_USERS = {
  'admin':    {empId:'EMP-001',password:'admin123',   name:'Al Santos',           role:'Admin / Owner',  access:'Full Access'},
  'jerome':   {empId:'EMP-002',password:'emp123',     name:'Jerome Mabalot',      role:'Barista',        access:'Employee Access'},
  'lalaine':  {empId:'EMP-003',password:'lalaine123', name:'Lalaine Miranda',     role:'Cashier',        access:'Employee Access'},
  'mechaila': {empId:'EMP-004',password:'mec123',     name:'Mechaila Macacalalad',role:'Barista',        access:'Employee Access'},
  'gabriel':  {empId:'EMP-005',password:'gab123',     name:'Gabriel Nava',        role:'Kitchen Staff',  access:'Employee Access'},
  'maria':    {empId:'EMP-006',password:'maria123',   name:'Maria Cruz',          role:'Supervisor',     access:'Supervisor Access'},
  'renz':     {empId:'EMP-007',password:'renz123',    name:'Renz Dela Torre',     role:'Barista',        access:'Employee Access'},
  'bong':     {empId:'EMP-009',password:'bong123',    name:'Bong Villanueva',     role:'Delivery',       access:'Employee Access'},
};

let attData = [
  {id:1, empId:'EMP-002',name:'Jerome Mabalot',      date:'2026-03-04',timeIn:'08:00 AM',timeOut:'05:00 PM',hours:'9',    status:'ON TIME',  notes:''},
  {id:2, empId:'EMP-003',name:'Lalaine Miranda',      date:'2026-03-04',timeIn:'08:15 AM',timeOut:'--:--',  hours:'--',   status:'LATE',     notes:'No clock-out yet'},
  {id:3, empId:'EMP-004',name:'Mechaila Macacalalad', date:'2026-03-03',timeIn:'09:00 AM',timeOut:'06:00 PM',hours:'9',   status:'ON TIME',  notes:''},
  {id:4, empId:'EMP-005',name:'Gabriel Nava',         date:'2026-03-03',timeIn:'08:00 AM',timeOut:'07:30 PM',hours:'11.5',status:'OVERTIME', notes:'Extended shift'},
  {id:5, empId:'EMP-006',name:'Maria Cruz',           date:'2026-03-04',timeIn:'07:45 AM',timeOut:'05:00 PM',hours:'9.25',status:'ON TIME',  notes:''},
  {id:6, empId:'EMP-007',name:'Renz Dela Torre',      date:'2026-03-04',timeIn:'08:00 AM',timeOut:'05:00 PM',hours:'9',   status:'ON TIME',  notes:''},
  {id:7, empId:'EMP-009',name:'Bong Villanueva',      date:'2026-03-04',timeIn:'--:--',  timeOut:'--:--',  hours:'--',   status:'ABSENT',   notes:'No show'},
  {id:8, empId:'EMP-002',name:'Jerome Mabalot',       date:'2026-03-03',timeIn:'08:00 AM',timeOut:'05:00 PM',hours:'9',   status:'ON TIME',  notes:''},
  {id:9, empId:'EMP-007',name:'Renz Dela Torre',      date:'2026-03-03',timeIn:'09:30 AM',timeOut:'06:30 PM',hours:'9',   status:'LATE',     notes:'Notified supervisor'},
  {id:10,empId:'EMP-001',name:'Al Santos',            date:'2026-03-04',timeIn:'08:30 AM',timeOut:'08:00 PM',hours:'11.5',status:'OVERTIME', notes:'Admin duty'},
];



let invData = {
  // ID MAPPING (synced to Hasura DB — screenshots confirm these IDs):
  // INV-031 = Arabica Beans        INV-002 = Espresso Roast Beans
  // INV-042 = Whole Milk (Esprss)  INV-041 = Oat Milk (Espresso)
  // INV-044 = Sugar Syrup          INV-043 = Filtered Water
  // INV-007 = Skimmed Milk
  // INV-008 = Matcha Powder        INV-009 = Chamomile Bags
  // INV-010 = Cocoa Powder         INV-011 = Ice Cubes
  // INV-014 = Croissants           INV-015 = Muffin Mix   INV-016 = Chocolate Chips
  // INV-034 = Hot Cups Reg         INV-035 = Hot Cups Med  INV-036 = Hot Cups Lrg
  // INV-037 = Iced Cups Reg        INV-038 = Iced Cups Med INV-039 = Iced Cups Lrg
  // INV-040 = Straws
  'Espresso':[
    {id:'INV-031',name:'Arabica Beans',       unit:'Grams (g)',     stock:200, threshold:50,  lastRestocked:'2026-03-01',supplier:'starbucks',      notes:'Premium Grade A — used in all espresso drinks'},
    {id:'INV-002',name:'Espresso Roast Beans', unit:'Grams (g)',     stock:200, threshold:0,   lastRestocked:'2026-03-07',supplier:'CoffeeHub PH',   notes:'Espresso roast — alternate bean'},
    {id:'INV-042',name:'Whole Milk',           unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'FarmFresh Dairy', notes:'Used in Cappuccino, Macchiato'},
    {id:'INV-041',name:'Oat Milk',             unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-10',supplier:'FarmFresh Dairy', notes:'Alt milk option'},
    {id:'INV-044',name:'Sugar Syrup',           unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-05',supplier:'FarmFresh Dairy', notes:'Used across all drinks'},
    {id:'INV-043',name:'Filtered Water',        unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-10',supplier:'IcePack MNL',    notes:'Americano, Lungo, Ristretto base'},
    {id:'INV-007',name:'Skimmed Milk',          unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'FarmFresh Dairy', notes:'Low-fat milk option'},
  ],
  'Milk-based':[
    {id:'INV-041',name:'Oat Milk',              unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-10',supplier:'FarmFresh Dairy', notes:'Alt milk — Milk-based drinks'},
    {id:'INV-042',name:'Whole Milk',            unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'FarmFresh Dairy', notes:'Base for Latte, Flat White, Mocha'},
    {id:'INV-007',name:'Skimmed Milk',          unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'FarmFresh Dairy', notes:'Low-fat option'},
    {id:'INV-044',name:'Sugar Syrup',           unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-05',supplier:'FarmFresh Dairy', notes:'Sweetener for milk-based drinks'},
  ],
  'Non-Coffee':[
    {id:'INV-008',name:'Matcha Powder',          unit:'Grams (g)',     stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'TeaLeaf Supply',  notes:'For Matcha Latte'},
    {id:'INV-009',name:'Chamomile Bags',          unit:'Pieces (pcs)',  stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'TeaLeaf Supply',  notes:'For Chamomile Tea'},
    {id:'INV-010',name:'Cocoa Powder',            unit:'Grams (g)',     stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'CoffeeHub PH',    notes:'For Hot Choco'},
  ],
  'Iced':[
    {id:'INV-011',name:'Ice Cubes',               unit:'Kilograms (kg)',stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'IcePack MNL',    notes:'Used in all iced drinks'},
    {id:'INV-031',name:'Arabica Beans',            unit:'Grams (g)',     stock:199, threshold:0,   lastRestocked:'2026-03-06',supplier:'starbucks',      notes:'Base for Iced Americano & Iced Latte'},
    {id:'INV-042',name:'Whole Milk (Iced)',        unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-06',supplier:'FarmFresh Dairy', notes:'For Iced Latte'},
    {id:'INV-008',name:'Matcha Powder (Iced)',     unit:'Grams (g)',     stock:200, threshold:0,   lastRestocked:'2026-03-06',supplier:'TeaLeaf Supply',  notes:'For Iced Matcha'},
    {id:'INV-044',name:'Simple Syrup (Iced)',      unit:'Liters (L)',    stock:200, threshold:0,   lastRestocked:'2026-03-06',supplier:'FarmFresh Dairy', notes:'Sweetener for iced drinks'},
  ],
  'Pastries':[
    {id:'INV-014',name:'Croissants',              unit:'Pieces (pcs)',  stock:200, threshold:0,   lastRestocked:'2026-03-05',supplier:'BakeryFresh',    notes:'Delivered daily — sold as-is'},
    {id:'INV-015',name:'Muffin Mix',               unit:'Grams (g)',     stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'BakeryFresh',    notes:'For Blueberry Muffin'},
    {id:'INV-016',name:'Chocolate Chips',          unit:'Grams (g)',     stock:200, threshold:0,   lastRestocked:'2026-03-01',supplier:'BakeryFresh',    notes:'For Chocolate Donut glaze & muffins'},
  ],
  'Utensils':[
    {id:'INV-034',name:'Hot Cups – Regular (8oz)',  unit:'Pieces (pcs)', stock:100, threshold:0,   lastRestocked:'2026-03-01',supplier:'Starbucks',      notes:'Hot drinks – Regular size'},
    {id:'INV-035',name:'Hot Cups – Medium (12oz)',  unit:'Pieces (pcs)', stock:100, threshold:0,   lastRestocked:'2026-03-01',supplier:'Starbucks',      notes:'Hot drinks – Medium size'},
    {id:'INV-036',name:'Hot Cups – Large (16oz)',   unit:'Pieces (pcs)', stock:100, threshold:0,   lastRestocked:'2026-03-01',supplier:'Starbucks',      notes:'Hot drinks – Large size'},
    {id:'INV-037',name:'Iced Cups – Regular (16oz)',unit:'Pieces (pcs)', stock:100, threshold:0,   lastRestocked:'2026-03-01',supplier:'Starbucks',      notes:'Iced drinks – Regular size'},
    {id:'INV-038',name:'Iced Cups – Medium (22oz)', unit:'Pieces (pcs)', stock:100, threshold:0,   lastRestocked:'2026-03-01',supplier:'Starbucks',      notes:'Iced drinks – Medium size'},
    {id:'INV-039',name:'Iced Cups – Large (24oz)',  unit:'Pieces (pcs)', stock:100, threshold:0,   lastRestocked:'2026-03-01',supplier:'Starbucks',      notes:'Iced drinks – Large size'},
    {id:'INV-040',name:'Straws',                    unit:'Pieces (pcs)', stock:100, threshold:0,   lastRestocked:'2026-03-01',supplier:'Starbucks',      notes:'For iced drinks – all sizes'},
  ]
};

// Ingredient selections per category for Add Item modal
const INV_ITEMS_BY_CAT = {
  'Espresso':   [
    {name:'Arabica Beans',        unit:'Grams (g)'},
    {name:'Espresso Roast Beans', unit:'Grams (g)'},
    {name:'Whole Milk',           unit:'Liters (L)'},
    {name:'Oat Milk',             unit:'Liters (L)'},
    {name:'Skimmed Milk',         unit:'Liters (L)'},
    {name:'Sugar Syrup',          unit:'Liters (L)'},
    {name:'Filtered Water',       unit:'Liters (L)'},
  ],
  'Milk-based': [
    {name:'Whole Milk',   unit:'Liters (L)'},
    {name:'Oat Milk',     unit:'Liters (L)'},
    {name:'Skimmed Milk', unit:'Liters (L)'},
    {name:'Sugar Syrup',  unit:'Liters (L)'},
  ],
  'Non-Coffee': [
    {name:'Matcha Powder',    unit:'Grams (g)'},
    {name:'Chamomile Bags',   unit:'Pieces (pcs)'},
    {name:'Cocoa Powder',     unit:'Grams (g)'},
  ],
  'Iced': [
    {name:'Ice Cubes',        unit:'Kilograms (kg)'},
    {name:'Arabica Beans',    unit:'Grams (g)'},
    {name:'Whole Milk',       unit:'Liters (L)'},
    {name:'Matcha Powder',    unit:'Grams (g)'},
    {name:'Sugar Syrup',      unit:'Liters (L)'},
  ],
  'Pastries': [
    {name:'Croissants',      unit:'Pieces (pcs)'},
    {name:'Muffin Mix',      unit:'Grams (g)'},
    {name:'Chocolate Chips', unit:'Grams (g)'},
    {name:'Cocoa Powder',    unit:'Grams (g)'},
  ],
  'Utensils': [
    {name:'Hot Cups – Regular (8oz)',   unit:'Pieces (pcs)'},
    {name:'Hot Cups – Medium (12oz)',   unit:'Pieces (pcs)'},
    {name:'Hot Cups – Large (16oz)',    unit:'Pieces (pcs)'},
    {name:'Iced Cups – Regular (16oz)', unit:'Pieces (pcs)'},
    {name:'Iced Cups – Medium (22oz)',  unit:'Pieces (pcs)'},
    {name:'Iced Cups – Large (24oz)',   unit:'Pieces (pcs)'},
    {name:'Straws',                     unit:'Pieces (pcs)'},
  ],
};

const SUPPLIERS = ['IcePack MNL','PackagingPro','TeaLeaf Supply','CoffeeHub PH','FarmFresh Dairy','PlantBase PH','Starbucks'];

// ══════════════════════════════════════════════
// MENU DATA
// ══════════════════════════════════════════════
let currentUser={}, cart=[], orderCounter=3301, dineMode='dine-in';
let invEditMode=false, activeCat='Espresso', activeInvCat='Espresso';

const CATS=[
  {name:'Espresso',icon:'☕'},{name:'Milk-based',icon:'🥛'},
  {name:'Non-Coffee',icon:'🍵'},{name:'Iced',icon:'🧊'},{name:'Pastries',icon:'🍩'},
  {name:'Utensils',icon:'🥤'}
];

const MENU={
  'Espresso':[
    {id:1, name:'Espresso Solo', price:69, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1510707577719-ae7c14805e3a?w=200&q=80'},
    {id:2, name:'Americano',    price:79, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1551030173-122aabc4489c?w=200&q=80'},
    {id:3, name:'Cappuccino',   price:89, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=200&q=80'},
    {id:4, name:'Macchiato',    price:95, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1485808191679-5f86510bd9d4?w=200&q=80'},
    {id:5, name:'Lungo',        price:85, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=200&q=80'},
    {id:6, name:'Ristretto',    price:75, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1504630083234-14187a9df0f5?w=200&q=80'},
  ],
  'Milk-based':[
    {id:7, name:'Latte',     price:99, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1561047029-3000c68339ca?w=200&q=80'},
    {id:8, name:'Flat White',price:99, adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1577968897966-3d4325b36b61?w=200&q=80'},
    {id:9, name:'Mocha',     price:109,adj:{R:0,M:15,L:25}, sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1572286258217-215cf8e7e054?w=200&q=80'},
  ],
  'Non-Coffee':[
    {id:10,name:'Matcha Latte', price:119,adj:{R:0,M:15,L:25},sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1536256263959-770b48d82b0a?w=200&q=80'},
    {id:11,name:'Chamomile Tea',price:79, adj:{R:0,M:10,L:15},sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=200&q=80'},
    {id:12,name:'Hot Choco',    price:89, adj:{R:0,M:15,L:25},sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1542990253-0d0f5be5f0ed?w=200&q=80'},
  ],
  'Iced':[
    {id:13,name:'Iced Americano',price:79, adj:{R:0,M:15,L:25},sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=200&q=80'},
    {id:14,name:'Iced Latte',    price:109,adj:{R:0,M:15,L:25},sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=200&q=80'},
    {id:15,name:'Iced Matcha',   price:129,adj:{R:0,M:15,L:25},sizes:['R','M','L'],img:'https://images.unsplash.com/photo-1515823064-d6e0c04616a7?w=200&q=80'},
  ],
  'Pastries':[
    {id:16,name:'Croissant',        price:69,adj:{},sizes:[],img:'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=200&q=80'},
    {id:17,name:'Blueberry Muffin', price:79,adj:{},sizes:[],img:'https://images.unsplash.com/photo-1607958996333-41aef7caefaa?w=200&q=80'},
    {id:18,name:'Chocolate Donut',  price:59,adj:{},sizes:[],img:'https://images.unsplash.com/photo-1551024601-bec78aea704b?w=200&q=80'},
  ]
};

let ordersData=[
  {id:3300,customer:'Walk-in',time:'10:30 AM',item:'1x Espresso Solo (Reg)',  amount:69, status:'Completed'},
  {id:3299,customer:'Walk-in',time:'10:15 AM',item:'1x Americano (Med)',      amount:94, status:'Completed'},
  {id:3298,customer:'Walk-in',time:'09:50 AM',item:'1x Matcha Latte (Lrg)',  amount:144,status:'Pending'},
];

// ══════════════════════════════════════════════
// INGREDIENT RECIPE MAP
// Maps menu item name → ingredients deducted per serving (qty per order)
// Units match invData units for each item
// ══════════════════════════════════════════════
// Cup size maps — keyed by size label (IDs synced to Hasura DB from screenshots)
// Hot cups:  INV-034 (8oz Reg) | INV-035 (12oz Med) | INV-036 (16oz Lrg)
// Iced cups: INV-037 (16oz Reg)| INV-038 (22oz Med) | INV-039 (24oz Lrg)
// Straw:     INV-040
// Cup size maps — keyed by size label (IDs synced to Hasura DB from screenshots)
// Hot cups:  INV-034 (8oz Reg) | INV-035 (12oz Med) | INV-036 (16oz Lrg)
// Iced cups: INV-037 (16oz Reg)| INV-038 (22oz Med) | INV-039 (24oz Lrg)
// Straw:     INV-040
const HOT_CUP_MAP   = {'Regular':'INV-034','Medium':'INV-035','Large':'INV-036'};
const ICED_CUP_MAP  = {'Regular':'INV-037','Medium':'INV-038','Large':'INV-039'};
const ICED_STRAW_ID = 'INV-040';

// ─────────────────────────────────────────────────────────────────
// INGREDIENT RECIPES — amounts per Regular serving (qty=1)
// Medium = 1.3×, Large = 1.6× (via SIZE_SCALE)
// Cups/straws: always exactly 1 per drink, never size-scaled
// Filtered Water (INV-043) is used as the liquid base in ALL drinks
//
// Ingredient ID legend (matched to Hasura DB):
//   INV-031 = Arabica Beans (g)       INV-002 = Espresso Roast Beans (g)
//   INV-042 = Whole Milk (L)          INV-041 = Oat Milk (L)
//   INV-044 = Sugar Syrup (L)         INV-043 = Filtered Water (L)
//   INV-007 = Skimmed Milk (L)
//   INV-008 = Matcha Powder (g)       INV-009 = Chamomile Bags (pcs)
//   INV-010 = Cocoa Powder (g)        INV-011 = Ice Cubes (kg)
//   INV-014 = Croissants (pcs)        INV-015 = Muffin Mix (g)
//   INV-016 = Chocolate Chips (g)
// ─────────────────────────────────────────────────────────────────
const RECIPES = {
  // ── ESPRESSO (hot) ────────────────────────────────────────────
  // Beans | Filtered Water | Milk (where applicable) | Hot Cup
  'Espresso Solo': [['INV-031',18], ['INV-043',0.06], ['HOT_CUP',1]],
  'Americano':     [['INV-031',18], ['INV-043',0.15], ['HOT_CUP',1]],
  'Cappuccino':    [['INV-031',18], ['INV-043',0.05], ['INV-042',0.12], ['HOT_CUP',1]],
  'Macchiato':     [['INV-031',18], ['INV-043',0.04], ['INV-042',0.05], ['HOT_CUP',1]],
  'Lungo':         [['INV-031',22], ['INV-043',0.18], ['HOT_CUP',1]],
  'Ristretto':     [['INV-031',14], ['INV-043',0.04], ['HOT_CUP',1]],

  // ── MILK-BASED (hot) ──────────────────────────────────────────
  // Beans | Filtered Water | Milk | Syrup/Sauce | Hot Cup
  'Latte':      [['INV-031',18], ['INV-043',0.05], ['INV-042',0.2],  ['INV-044',0.01], ['HOT_CUP',1]],
  'Flat White': [['INV-031',18], ['INV-043',0.04], ['INV-042',0.15], ['HOT_CUP',1]],
  'Mocha':      [['INV-031',18], ['INV-043',0.05], ['INV-042',0.2],  ['INV-010',20],   ['HOT_CUP',1]],

  // ── NON-COFFEE (hot) ──────────────────────────────────────────
  // Powder/bags | Filtered Water | Milk | Sweetener | Hot Cup
  'Matcha Latte':  [['INV-008',8],  ['INV-043',0.05], ['INV-042',0.2],  ['INV-044',0.01], ['HOT_CUP',1]],
  'Chamomile Tea': [['INV-009',1],  ['INV-043',0.2],  ['INV-044',0.01], ['HOT_CUP',1]],
  'Hot Choco':     [['INV-010',20], ['INV-043',0.05], ['INV-042',0.2],  ['INV-044',0.01], ['HOT_CUP',1]],

  // ── ICED ──────────────────────────────────────────────────────
  // Beans/Powder | Filtered Water | Milk | Ice | Syrup | Iced Cup | Straw
  'Iced Americano': [['INV-031',18], ['INV-043',0.1],  ['INV-011',0.2],  ['INV-044',0.01], ['ICED_CUP',1], ['ICED_STRAW',1]],
  'Iced Latte':     [['INV-031',18], ['INV-043',0.05], ['INV-042',0.15], ['INV-011',0.2],  ['INV-044',0.01], ['ICED_CUP',1], ['ICED_STRAW',1]],
  'Iced Matcha':    [['INV-008',10], ['INV-043',0.05], ['INV-042',0.2],  ['INV-011',0.2],  ['INV-044',0.01], ['ICED_CUP',1], ['ICED_STRAW',1]],

  // ── PASTRIES ──────────────────────────────────────────────────
  'Croissant':       [['INV-014',1]],
  'Blueberry Muffin':[['INV-015',80], ['INV-016',15]],
  'Chocolate Donut': [['INV-010',15], ['INV-016',10]],
};

// Scale ingredient deductions by size (R=1x, M=1.3x, L=1.6x)
const SIZE_SCALE = {'Regular':1.0,'Medium':1.3,'Large':1.6,'':1.0};

const nhostInsertInvLog = o => gqlSilent(`mutation($obj:inventory_log_insert_input!){insert_inventory_log_one(object:$obj){id}}`,{obj:o});

function deductInventory(cartItems){
  const log = [];
  const removed = [];
  // Sentinel IDs that should NOT be scaled by size (1 cup/straw per drink regardless of size)
  const NO_SCALE_SENTINELS = new Set(['HOT_CUP','ICED_CUP','ICED_STRAW']);
  for(const ci of cartItems){
    const recipe = RECIPES[ci.name];
    if(!recipe) continue;
    const sizeScale = SIZE_SCALE[ci.size] || 1.0;
    for(let [invId, baseAmt] of recipe){
      // Cups and straws: 1 per drink qty, not scaled by size
      const isCupOrStraw = NO_SCALE_SENTINELS.has(invId);
      const amt = Math.round(baseAmt * (isCupOrStraw ? 1.0 : sizeScale) * ci.qty);
      // Resolve cup/straw sentinels using the size of the cart item
      const sizeLbl = ci.size === 'Regular' ? 'Regular' : ci.size === 'Medium' ? 'Medium' : 'Large';
      if(invId==='HOT_CUP')    invId = HOT_CUP_MAP[sizeLbl]  || 'INV-034';
      if(invId==='ICED_CUP')   invId = ICED_CUP_MAP[sizeLbl] || 'INV-037';
      if(invId==='ICED_STRAW') invId = ICED_STRAW_ID;
      // Find item across all categories
      for(const cat of Object.keys(invData)){
        const item = invData[cat].find(i => i.id === invId);
        if(item){
          const prevStock = item.stock;
          item.stock = Math.round(Math.max(0, item.stock - amt));
          log.push(`${item.name} -${amt} ${item.unit}`);
          nhostUpdateStock(item.id, item.stock);
          nhostInsertInvLog({
            inventory_id: item.id, item_name: item.name,
            qty_deducted: amt, unit: item.unit,
            stock_before: prevStock, stock_after: item.stock,
            reason: 'Order sale',
            logged_by: currentUser ? currentUser.name : 'System',
            logged_at: new Date().toISOString()
          });
          if(item.stock <= item.threshold){
            removed.push({cat, id: item.id, name: item.name});
          }
          break;
        }
      }
    }
  }
  for(const r of removed){
    invData[r.cat] = invData[r.cat].filter(i => i.id !== r.id);
    gql(`mutation($id:String!){delete_inventory_by_pk(id:$id){id}}`,{id:r.id});
    log.push(`⚠ ${r.name} removed — reached threshold`);
    setTimeout(()=>toast(`🗑 ${r.name} auto-removed (reached threshold)`), 400);
  }
  return log;
}

// ══════════════════════════════════════════════
// LOGIN / LOGOUT
// ══════════════════════════════════════════════
function switchRole(r){
  document.querySelectorAll('.role-tab').forEach((t,i)=>
    t.classList.toggle('active',(i===0&&r==='employee')||(i===1&&r==='admin')));
}
function doLogin(){
  const u=document.getElementById('lu').value.trim().toLowerCase();
  const p=document.getElementById('lp').value;
  if(!u||!p){toast('Enter username and password');return;}
  const user=DB_USERS[u];
  if(!user||user.password!==p){toast('Invalid credentials');return;}
  const selectedTab=document.querySelector('.role-tab.active').textContent.trim().toLowerCase();
  const isAdminUser=user.access==='Full Access'||user.access==='Supervisor Access';
  if(selectedTab==='admin'&&!isAdminUser){toast('Access denied. Use the Employee tab.');return;}
  if(selectedTab==='employee'&&isAdminUser){toast('Please use the Admin tab to log in.');return;}
  currentUser=user;
  document.getElementById('sb-name').textContent=user.name;
  document.getElementById('sb-role').textContent=user.role;
  document.getElementById('sb-avatar').textContent=user.name[0].toUpperCase();
  document.getElementById('login-page').style.display='none';
  document.getElementById('app').style.display='flex';
  initApp(); toast('Welcome, '+user.name.split(' ')[0]+'! ✦');
  checkNhost();
  loadFromHasura();
}
function doLogout(){
  document.getElementById('login-page').style.display='flex';
  document.getElementById('app').style.display='none';
  document.getElementById('lu').value='';
  document.getElementById('lp').value='';
  cart=[];
}

// ══════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════
function initApp(){
  renderCats();renderInvCats();renderMenu();renderMiniOrders();
  renderOrders();renderInv();renderAtt();fillAttDropdown();
  updateCart();checkLowStock();
  updateClock();setInterval(updateClock,1000);
  const isAdmin=currentUser.access==='Full Access';
  const isSupervisor=currentUser.access==='Supervisor Access';
  const canManage = isAdmin || isSupervisor;
  const isEmployee = currentUser.access === 'Employee Access';

  // For admin: default attendance date filter to today
  if(isAdmin){
    const dateEl = document.getElementById('att-date');
    if(dateEl) dateEl.value = todayStr();
  }

  // Inventory: employees CAN edit (stock updates) — only Add/Delete restricted to Admin
  document.getElementById('inv-adm-note').style.display = 'none';
  document.getElementById('inv-edit-btn').style.display = 'inline';
  document.querySelector('button[onclick="dlInvCSV()"]').style.display = isAdmin ? 'inline' : 'none';

  // Attendance: admin/supervisor can add/download; employees see their own records + time clock
  document.getElementById('att-add-btn').style.display = isAdmin ? 'inline' : 'none';
  document.querySelector('button[onclick="dlAttCSV()"]').style.display = isAdmin ? 'inline' : 'none';

  // Orders: employees can VIEW, mark done, and void — no manual add, no download
  document.querySelector('button[onclick="openModal(\'order\')"]').style.display = isAdmin ? 'inline' : 'none';
  document.querySelector('button[onclick="dlOrdersCSV()"]').style.display = isAdmin ? 'inline' : 'none';

  // Inventory nav: visible to all
  // Attendance nav: visible to employees too (they see their own notes)
  document.getElementById('nav-inventory').style.display = 'flex';
  document.getElementById('nav-attendance').style.display = 'flex';

  // Show employee notes banner if employee
  if(isEmployee){
    renderEmpNotes();
  }
  initTimeClock();
}
function updateClock(){
  const n=new Date(),h=n.getHours(),m=n.getMinutes();
  const ap=h>=12?'PM':'AM',hh=((h%12)||12).toString().padStart(2,'0'),mm=m.toString().padStart(2,'0');
  const el=document.getElementById('hdr-time');
  if(el)el.textContent=n.toLocaleDateString('en-PH',{weekday:'short',month:'short',day:'numeric'})+' · '+hh+':'+mm+' '+ap;
}
function navigate(pg){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('page-'+pg).classList.add('active');
  const el=document.getElementById('nav-'+pg);
  if(el)el.classList.add('active');
  if(pg==='attendance'){
    if(currentUser.access==='Employee Access') renderEmpNotes();
    if(currentUser.access==='Full Access'){
      // Default the date filter to today so stats show today's counts
      const dateEl = document.getElementById('att-date');
      if(dateEl && !dateEl.value) dateEl.value = todayStr();
      renderEditRequests(); switchAttTab('logs');
    }
    syncTcState();
  }
}

// ══════════════════════════════════════════════
// MENU
// ══════════════════════════════════════════════
function renderCats(){
  document.getElementById('cats-row').innerHTML=CATS.map(c=>`
    <div class="cat-btn ${c.name===activeCat?'active':''}" onclick="selCat('${c.name}')">
      <div class="cat-ico">${c.icon}</div><div class="cat-lbl">${c.name}</div>
    </div>`).join('');
}
function selCat(n){activeCat=n;document.getElementById('active-cat-lbl').textContent=n;renderCats();renderMenu();}
function renderMenu(f=''){
  const items=(MENU[activeCat]||[]).filter(i=>i.name.toLowerCase().includes(f.toLowerCase()));
  document.getElementById('menu-grid').innerHTML=items.map(item=>`
    <div class="menu-card">
      <div class="menu-card-img">
        <img src="${item.img}" alt="${item.name}" loading="lazy" onerror="this.parentElement.style.background='#e8f0d8';this.remove()">
      </div>
      <div class="menu-card-body">
        <div class="menu-card-name">${item.name}</div>
        <div class="menu-card-price">₱${item.price} <span style="font-size:11px;color:var(--text-light);font-weight:400">/Reg</span></div>
        <div class="size-btns">
          ${item.sizes.map(s=>{
            const lbl=s==='R'?'Reg':s==='M'?'Med':'Lrg';
            return `<button class="sz-btn" onclick="addToCart(${item.id},'${s}');event.stopPropagation()">${lbl}</button>`;
          }).join('')}
          ${!item.sizes.length?`<button class="sz-btn" onclick="addToCart(${item.id},'');event.stopPropagation()">Add</button>`:''}
        </div>
      </div>
    </div>`).join('');
}
function filterMenu(){renderMenu(document.getElementById('menu-search').value);}

// ══════════════════════════════════════════════
// CART
// ══════════════════════════════════════════════
function sizeLabel(s){return s==='R'?'Regular':s==='M'?'Medium':s==='L'?'Large':s||'Regular';}
function addToCart(itemId,size){
  const item=Object.values(MENU).flat().find(i=>i.id===itemId);
  if(!item)return;

  // ── Ingredient check ──
  const recipe=RECIPES[item.name];
  if(recipe){
    const allInv=Object.values(invData).flat();
    const insufficient=[];
    const NO_SCALE = new Set(['HOT_CUP','ICED_CUP','ICED_STRAW']);
    for(let [invId,qty] of recipe){
      const sl = size==='R'?'Regular':size==='M'?'Medium':'Large';
      // Cups/straws: always 1, not size-scaled
      const scaledQty = NO_SCALE.has(invId) ? qty : qty * (SIZE_SCALE[sl]||1.0);
      if(invId==='HOT_CUP')   invId=HOT_CUP_MAP[sl]||'INV-034';
      if(invId==='ICED_CUP')  invId=ICED_CUP_MAP[sl]||'INV-037';
      if(invId==='ICED_STRAW')invId=ICED_STRAW_ID;
      const inv=allInv.find(i=>i.id===invId);
      if(!inv) continue;
      if(inv.stock<scaledQty){
        insufficient.push({name:inv.name,have:inv.stock,need:scaledQty,unit:inv.unit,status:inv.stock<=0?'OUT':'LOW'});
      }
    }
    if(insufficient.length){
      const rows=insufficient.map(i=>`
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-radius:9px;margin-bottom:7px;background:${i.status==='OUT'?'rgba(181,48,31,0.07)':'rgba(217,101,10,0.07)'};border:1px solid ${i.status==='OUT'?'rgba(181,48,31,0.2)':'rgba(217,101,10,0.2)'}">
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--text-dark)">${i.name}</div>
            <div style="font-size:11px;color:var(--text-light);margin-top:2px">Needs <strong>${i.need} ${i.unit}</strong> — only <strong>${i.have} ${i.unit}</strong> left</div>
          </div>
          <span style="font-size:11px;font-weight:800;padding:3px 10px;border-radius:20px;background:${i.status==='OUT'?'var(--red)':'var(--orange)'};color:white">${i.status}</span>
        </div>`).join('');
      const box=document.getElementById('modal-box');
      document.getElementById('modal-overlay').classList.add('open');
      box.innerHTML=`
        <button class="modal-close" onclick="closeModal()">✕</button>
        <div style="text-align:center;font-size:28px;margin-bottom:6px">⚠️</div>
        <div class="modal-title" style="text-align:center;margin-bottom:4px">Cannot Add to Cart</div>
        <div style="text-align:center;font-size:13px;color:var(--text-light);margin-bottom:18px">
          <strong>${item.name}</strong> cannot be prepared — the following ingredients don't meet the required amount:
        </div>
        ${rows}
        <div style="margin-top:16px;padding:10px 14px;background:rgba(30,61,15,0.05);border-radius:9px;font-size:12px;color:var(--text-mid)">
          💡 Restock the ingredients above in <strong>Inventory</strong> before adding this item.
        </div>
        <div class="modal-actions" style="margin-top:14px">
          <button class="btn-cancel" onclick="closeModal()">Close</button>
          <button class="btn-o" onclick="closeModal();navigate('inventory')">Go to Inventory →</button>
        </div>`;
      return;
    }
  }

  const price=item.price+((item.adj&&item.adj[size])||0);
  const key=itemId+'-'+size;
  const ex=cart.find(c=>c.key===key);
  if(ex)ex.qty++;
  else cart.push({key,id:itemId,name:item.name,price,size:sizeLabel(size),qty:1,img:item.img});
  updateCart();toast(item.name+' ('+sizeLabel(size)+') added!');
}
function removeFromCart(key){cart=cart.filter(c=>c.key!==key);updateCart();}
function changeQty(key,d){const i=cart.find(c=>c.key===key);if(!i)return;i.qty+=d;if(i.qty<=0)removeFromCart(key);else updateCart();}
function clearCart(){cart=[];updateCart();toast('Cart cleared');}
function updateCart(){
  const c=document.getElementById('cart-container');
  if(!cart.length){
    c.innerHTML='<div class="empty-cart"><div class="empty-cart-icon">☕</div><div class="empty-cart-text">No items yet. Add from the menu!</div></div>';
  }else{
    c.innerHTML=cart.map(i=>`
      <div class="cart-item">
        <div class="cart-item-img"><img src="${i.img}" onerror="this.remove()" style="width:100%;height:100%;object-fit:cover"></div>
        <div class="cart-item-info">
          <div class="cart-item-name">${i.name}</div>
          <div class="cart-item-size">${i.size}</div>
          <div class="cart-item-price">₱${i.price}</div>
        </div>
        <div class="qty-ctrl">
          <button class="qty-btn" onclick="changeQty('${i.key}',-1)">−</button>
          <span class="qty-num">${i.qty}</span>
          <button class="qty-btn" onclick="changeQty('${i.key}',1)">+</button>
        </div>
      </div>`).join('');
  }
  const sub=cart.reduce((s,i)=>s+i.price*i.qty,0);
  document.getElementById('cart-sub').textContent='₱'+sub;
  document.getElementById('cart-total').textContent='₱'+sub;
}
function setDine(m){
  dineMode=m;
  document.getElementById('dt-in').classList.toggle('active',m==='dine-in');
  document.getElementById('dt-out').classList.toggle('active',m==='take-away');
}
// ══════════════════════════════════════════════
// POS PAYMENT (Cash Only)
// ══════════════════════════════════════════════
function openPosCalc(){
  if(!cart.length){toast('Add items to cart first!');return;}
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
  const items = cart.map(i=>`<div style="display:flex;justify-content:space-between;font-size:12px;padding:2px 0"><span>${i.qty}x ${i.name}${i.size?' ('+i.size+')':''}</span><span>₱${i.price*i.qty}</span></div>`).join('');
  document.getElementById('calc-receipt-items').innerHTML =
    items + `<div class="pos-calc-total"><span>TOTAL DUE</span><span>₱${total}</span></div>`;
  const quickAmts = [...new Set([total, Math.ceil(total/50)*50, Math.ceil(total/100)*100, Math.ceil(total/500)*500])].slice(0,4);
  document.getElementById('pos-quick-cash').innerHTML = quickAmts.map(a=>`<button class="pos-quick-btn" onclick="calcSetAmount(${a})">₱${a}</button>`).join('');
  const inp = document.getElementById('pos-cash-input');
  inp.value = '';
  document.getElementById('pos-change-row').style.display = 'none';
  document.getElementById('pos-confirm-btn').disabled = true;
  document.getElementById('pos-confirm-btn').style.opacity = '0.5';
  document.getElementById('pos-calc-overlay').classList.add('open');
  setTimeout(()=>inp.focus(), 100);
}
function closePosCalc(){
  document.getElementById('pos-calc-overlay').classList.remove('open');
}
function calcSetAmount(a){
  document.getElementById('pos-cash-input').value = a;
  updateCalcDisplay();
}
function updateCalcDisplay(){
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
  const cash = parseFloat(document.getElementById('pos-cash-input').value) || 0;
  const change = cash - total;
  const btn = document.getElementById('pos-confirm-btn');
  if(cash >= total){
    document.getElementById('pos-change-row').style.display = 'flex';
    document.getElementById('pos-change-amt').textContent = '₱' + change.toLocaleString('en-PH',{minimumFractionDigits:2,maximumFractionDigits:2});
    btn.disabled = false; btn.style.opacity = '1';
  } else {
    document.getElementById('pos-change-row').style.display = 'none';
    btn.disabled = true; btn.style.opacity = '0.5';
  }
}
function confirmPayment(){
  const total = cart.reduce((s,i)=>s+i.price*i.qty,0);
  const cash = parseFloat(document.getElementById('pos-cash-input').value) || 0;
  if(cash < total){toast('Cash is less than the total!');return;}
  const change = cash - total;
  closePosCalc();
  confirmOrder(cash, change);
}
function confirmOrder(cashTendered, changeAmt){
  if(!cart.length){toast('Add items to cart first!');return;}
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const itemStr=cart.map(c=>c.qty+'x '+c.name+' ('+c.size+')').join(', ');
  const order={id:orderCounter,customer:currentUser.name,
    time:new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}),
    item:itemStr,amount:total,status:'Pending',dineMode,
    cashTendered: cashTendered||total, changeAmt: changeAmt||0};
  ordersData.unshift(order);
  nhostInsertOrder({customer:order.customer,item:order.item,amount:order.amount,status:'Pending',time:order.time});
  // Deduct ingredients from inventory
  const deducted = deductInventory(cart.slice());
  checkLowStock(); renderInv(); renderInvCats();
  showReceipt(order,cart.slice(),deducted);
  cart=[];orderCounter++;
  document.getElementById('cart-num').textContent='Order #'+orderCounter;
  updateCart();renderMiniOrders();renderOrders();
}
function showReceipt(order,items,deducted){
  const box=document.getElementById('modal-box');
  document.getElementById('modal-overlay').classList.add('open');
  const invSection = deducted && deducted.length
    ? `<div style="margin-top:12px;padding:10px 14px;background:rgba(94,158,46,0.08);border-radius:9px;border:1px dashed var(--green-pale)">
        <div style="font-size:10px;font-weight:700;color:var(--text-light);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:6px">📦 Inventory Deducted</div>
        ${deducted.map(d=>`<div style="font-size:11px;color:var(--text-mid);padding:1px 0">• ${d}</div>`).join('')}
      </div>` : '';
  box.innerHTML=`<button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">Order Confirmed ✓</div>
    <div class="receipt">
      <div class="receipt-hdr">
        <div class="receipt-title">✦ Al's Cafe</div>
        <div style="font-size:12px;color:#888;margin-top:4px">Order #${order.id} · ${order.time} · ${order.dineMode==='dine-in'?'Dine In':'Take Away'}</div>
        <div style="font-size:12px;color:#888">Employee: ${order.customer}</div>
      </div>
      ${items.map(i=>`<div class="receipt-row"><span>${i.qty}x ${i.name} (${i.size})</span><span>₱${i.price*i.qty}</span></div>`).join('')}
      <div class="receipt-total"><span>TOTAL</span><span>₱${order.amount}</span></div>
      ${order.cashTendered ? `<div class="receipt-row" style="font-size:12px;color:#555"><span>Cash Tendered</span><span>₱${order.cashTendered}</span></div><div class="receipt-row" style="font-size:12px;color:var(--green-mid);font-weight:700"><span>Change</span><span>₱${order.changeAmt||0}</span></div>` : ''}
      <div class="receipt-footer">Thank you for visiting Al's Cafe! ☕<br>📍 Golden City, Sta. Rosa, Laguna</div>
    </div>
    ${invSection}
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Done</button>
    </div>`;
}

// ══════════════════════════════════════════════
// ORDERS
// ══════════════════════════════════════════════
function updatePendingBadge(){
  const n=ordersData.filter(o=>o.status==='Pending').length;
  const b=document.getElementById('pending-badge');
  b.style.display=n>0?'inline':'none';b.textContent=n;
}
function completeOrder(id){
  const o=ordersData.find(o=>o.id===id);
  if(o){o.status='Completed';renderOrders();renderMiniOrders();updatePendingBadge();toast('Order #'+id+' completed ✓');nhostCompleteOrder(id);}
}
function voidOrder(id){
  if(!confirm('Void Order #'+id+'? This cannot be undone.'))return;
  const o=ordersData.find(o=>o.id===id);
  if(o){
    o.status='Voided';
    renderOrders();renderMiniOrders();updatePendingBadge();
    toast('Order #'+id+' voided');
    gql(`mutation($id:Int!){update_orders_by_pk(pk_columns:{id:$id},_set:{status:"Voided"}){id}}`,{id});
  }
}
function clearVoided(){
  if(!ordersData.some(o=>o.status==='Voided')){toast('No voided orders to clear.');return;}
  if(!confirm('Clear all voided orders from the list?'))return;
  ordersData=ordersData.filter(o=>o.status!=='Voided');
  renderOrders();renderMiniOrders();
  toast('🗑 Voided orders cleared');
}
function renderMiniOrders(){
  document.getElementById('mini-orders-body').innerHTML=ordersData.slice(0,5).map(o=>`
    <tr>
      <td>${o.customer}</td><td>#${o.id}</td>
      <td style="font-size:12px;color:var(--text-light);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.item}</td>
      <td>₱${o.amount}</td>
      <td><span class="sbadge ${o.status==='Completed'?'s-completed':o.status==='Voided'?'s-voided':'s-pending'}">${o.status}</span></td>
    </tr>`).join('');
}
function renderOrders(){
  const total=ordersData.filter(o=>o.status!=='Voided').reduce((s,o)=>s+o.amount,0);
  const tl=document.getElementById('orders-total-lbl');
  if(tl)tl.textContent='Total: ₱'+total.toLocaleString();

  const statusBadge=o=>{
    if(o.status==='Pending') return `<span class="sbadge s-pending">Pending</span>`;
    if(o.status==='Completed') return `<span class="sbadge s-completed">Done</span>`;
    return `<span class="sbadge s-voided">Voided</span>`;
  };

  const actionCell=o=>{
    if(o.status==='Pending'){
      return `<button class="complete-btn" onclick="completeOrder(${o.id})">✓ Done</button><button class="void-btn" onclick="voidOrder(${o.id})">✕ Void</button>`;
    } else if(o.status==='Completed'){
      return `<button class="void-btn" onclick="voidOrder(${o.id})">✕ Void</button>`;
    } else {
      return `<button onclick="clearVoided(${o.id})" style="padding:4px 10px;background:rgba(181,48,31,0.1);color:var(--red);border:1px solid rgba(181,48,31,0.3);border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif">🗑 Remove</button>`;
    }
  };

  const rows=ordersData.map(o=>`
    <tr style="${o.status==='Voided'?'opacity:0.5;text-decoration:line-through':''}">
      <td><strong>${o.customer}</strong><br><span style="font-size:11px;color:var(--text-light)">${o.time}</span></td>
      <td>#${o.id}</td>
      <td style="font-size:12px;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.item}</td>
      <td>₱${o.amount}</td>
      <td style="text-decoration:none">${statusBadge(o)}</td>
      <td style="text-decoration:none">${actionCell(o)}</td>
    </tr>
  `).join('');

  const container=document.getElementById('pending-container');
  container.innerHTML=`
    <div class="order-card" style="overflow-x:auto">
      <table style="width:100%;border-collapse:collapse;font-size:13px;min-width:520px">
        <thead>
          <tr style="background:var(--green-bg)">
            <th style="padding:11px 13px;text-align:left;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:0.6px">Employee</th>
            <th style="padding:11px 13px;text-align:left;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:0.6px">Order #</th>
            <th style="padding:11px 13px;text-align:left;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:0.6px">Items</th>
            <th style="padding:11px 13px;text-align:left;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:0.6px">Amount</th>
            <th style="padding:11px 13px;text-align:left;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:0.6px">Status</th>
            <th style="padding:11px 13px;text-align:left;font-size:11px;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:0.6px">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rows || '<tr><td colspan="6" style="padding:14px;color:var(--text-light);font-size:13px">No orders yet.</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  // Hide the separate completed and voided sections since everything is in one table now
  const completedSec=document.getElementById('completed-container');
  if(completedSec) completedSec.closest('.orders-sec').style.display='none';
  const voidedSec=document.getElementById('voided-orders-sec');
  if(voidedSec) voidedSec.style.display='none';

  updatePendingBadge();
}
function clearVoided(id){
  if(id) ordersData=ordersData.filter(o=>o.id!==id);
  else ordersData=ordersData.filter(o=>o.status!=='Voided');
  renderOrders();
}

// ══════════════════════════════════════════════
// INVENTORY
// ══════════════════════════════════════════════
function renderInvCats(){
  document.getElementById('inv-cats-row').innerHTML=CATS.map(c=>{
    const items=invData[c.name]||[];
    const hasLow=items.some(i=>i.stock<=i.threshold);
    return `<div class="cat-btn ${c.name===activeInvCat?'active':''}" onclick="selInvCat('${c.name}')">
      <div class="cat-ico">${c.icon}${hasLow?'<span style="font-size:10px">⚠</span>':''}</div>
      <div class="cat-lbl">${c.name}</div>
    </div>`;}).join('');
}
function selInvCat(n){
  activeInvCat=n;
  document.getElementById('inv-sec-title').textContent=n+':';
  document.getElementById('inv-sec-static').textContent=n+':';
  renderInvCats();renderInv();
}
function checkLowStock(){
  const all=Object.values(invData).flat();
  const low=all.filter(i=>i.stock>0&&i.stock<=i.threshold);
  const out=all.filter(i=>i.stock<=0);
  const b=document.getElementById('low-stock-badge');
  const al=document.getElementById('inv-alert');
  const tot=low.length+out.length;
  if(tot>0){b.style.display='inline';b.textContent=tot;al.style.display='flex';
    document.getElementById('inv-alert-txt').textContent=(out.length?out.length+' OUT OF STOCK. ':'')+(low.length?low.length+' LOW STOCK — reorder soon.':'');
  }else{b.style.display='none';al.style.display='none';}
}
function toggleInvEdit(){
  invEditMode=!invEditMode;
  document.getElementById('inv-toolbar').style.display=invEditMode?'flex':'none';
  document.getElementById('inv-sec-static').style.display=invEditMode?'none':'block';
  document.getElementById('inv-edit-btn').textContent=invEditMode?'✓ Done':'Edit';
  renderInv();
}
function renderInv(){
  const isAdmin = currentUser.access === 'Full Access';
  const items=invData[activeInvCat]||[];
  document.getElementById('inv-tbl-hdr').innerHTML=invEditMode
    ?'<th></th><th>Item ID</th><th>Item Name</th><th>Unit</th><th>Stock</th><th>Threshold</th><th>Status</th><th>Last Restocked</th><th>Supplier</th><th>Notes</th>'
    :'<th>Item ID</th><th>Item Name</th><th>Unit</th><th>Stock</th><th>Threshold</th><th>Status</th><th>Last Restocked</th><th>Supplier</th><th>Notes</th>';
  // Show Add/Delete only to admin; Edit button visible to all
  const addBtn = document.querySelector('.btn-add');
  const delBtn = document.querySelector('.btn-del');
  if(addBtn) addBtn.style.display = isAdmin ? '' : 'none';
  if(delBtn) delBtn.style.display = isAdmin ? '' : 'none';
  document.getElementById('inv-tbl-body').innerHTML=items.map(i=>{
    const s=i.stock<=0?'<span class="stk-out">OUT</span>':i.stock<=i.threshold?'<span class="stk-low">LOW</span>':'<span class="stk-ok">OK</span>';
    const cb=invEditMode?`<td><input type="checkbox" class="row-cb inv-chk" data-id="${i.id}"></td>`:'';
    const bg=i.stock<=0?'background:#fde8e8':i.stock<=i.threshold?'background:#fff3cd':'';
    return `<tr style="${bg}">${cb}
      <td style="color:var(--text-light)">${i.id}</td>
      <td><strong>${i.name}</strong></td>
      <td>${i.unit}</td><td><strong>${i.stock}</strong></td><td>${i.threshold}</td><td>${s}</td>
      <td>${i.lastRestocked}</td><td style="color:var(--text-light)">${i.supplier}</td>
      <td style="font-size:12px;color:var(--text-light)">${i.notes||'—'}</td>
    </tr>`;}).join('');
}
function delSelectedInv(){
  const ids=[...document.querySelectorAll('.inv-chk:checked')].map(c=>c.dataset.id);
  if(!ids.length){toast('Select items to delete');return;}
  if(!confirm('Delete '+ids.length+' item(s)?'))return;
  Object.keys(invData).forEach(k=>{invData[k]=invData[k].filter(i=>!ids.includes(i.id));});
  // Sync deletions to Hasura
  ids.forEach(id => gql(`mutation($id:String!){delete_inventory_by_pk(id:$id){id}}`,{id}));
  renderInv();checkLowStock();renderInvCats();toast(ids.length+' item(s) deleted');
}

// ══════════════════════════════════════════════
// ATTENDANCE
// ══════════════════════════════════════════════
function renderEmpNotes(){
  const banner = document.getElementById('emp-notes-banner');
  const list = document.getElementById('emp-notes-list');
  if(!banner || !list) return;
  const isEmployee = currentUser.access === 'Employee Access';
  if(!isEmployee){banner.style.display='none';return;}
  // Find attendance records belonging to current employee that have notes
  const myRecords = attData.filter(r => r.empId === currentUser.empId && r.notes && r.notes.trim() !== '');
  if(myRecords.length === 0){banner.style.display='none';return;}
  const sc={'ON TIME':'stt-on-time','LATE':'stt-late','OVERTIME':'stt-overtime','ABSENT':'stt-absent'};
  list.innerHTML = myRecords.map(r=>`
    <div class="emp-note-row">
      <div class="emp-note-meta">📅 ${r.date} &nbsp;·&nbsp; ${r.timeIn} – ${r.timeOut}
        <span class="emp-note-status ${sc[r.status]||''}">${r.status}</span>
      </div>
      <div class="emp-note-text">💬 ${r.notes}</div>
    </div>`).join('');
  banner.style.display='block';
}
function fillAttDropdown(){
  const isEmployee = currentUser.access === 'Employee Access';
  if(isEmployee){
    // Employee only sees their own records — lock dropdown to their name
    const me = attData.find(r=>r.empId===currentUser.empId);
    document.getElementById('att-emp').innerHTML=`<option value="${currentUser.name}">${currentUser.name}</option>`;
    document.getElementById('att-emp').disabled = true;
    return;
  }
  const names=[...new Set(attData.map(r=>r.name))].sort();
  document.getElementById('att-emp').innerHTML='<option value="">All Employees</option>'+
    names.map(n=>`<option>${n}</option>`).join('');
  document.getElementById('att-emp').disabled = false;
}
function clearAttFilters(){
  const isEmployee = currentUser.access === 'Employee Access';
  const isAdmin = currentUser.access === 'Full Access';
  if(!isEmployee) document.getElementById('att-emp').value='';
  document.getElementById('att-status').value='';
  // Admin: reset to today (stats always reflect a date); Employee: clear date
  document.getElementById('att-date').value = isAdmin ? todayStr() : '';
  renderAtt();
}
function renderAtt(){
  const isEmployee = currentUser.access === 'Employee Access';
  const isAdmin = currentUser.access === 'Full Access';
  const ef=document.getElementById('att-emp').value;
  const sf=document.getElementById('att-status').value;
  const df=document.getElementById('att-date').value;
  let rows = isEmployee ? attData.filter(r=>r.empId===currentUser.empId) : attData;
  if(ef)rows=rows.filter(r=>r.name===ef);
  if(sf)rows=rows.filter(r=>r.status===sf);
  if(df)rows=rows.filter(r=>r.date===df);
  // Stats: for admin, count from the currently filtered date (defaults to today); for employee, all their records
  let countBase;
  if(isEmployee){
    countBase = attData.filter(r=>r.empId===currentUser.empId);
  } else {
    // Admin stats always reflect the selected date filter (or today if none chosen)
    const statDate = df || todayStr();
    countBase = attData.filter(r=>r.date===statDate);
  }
  document.getElementById('att-on-time').textContent=countBase.filter(r=>r.status==='ON TIME').length;
  document.getElementById('att-late').textContent=countBase.filter(r=>r.status==='LATE').length;
  document.getElementById('att-absent').textContent=countBase.filter(r=>r.status==='ABSENT').length;
  document.getElementById('att-overtime').textContent=countBase.filter(r=>r.status==='OVERTIME').length;
  // Show date context note for admin
  const dateNote = document.getElementById('att-stats-date-note');
  if(dateNote){
    if(isAdmin){
      const statDate = df || todayStr();
      const isToday = statDate === todayStr();
      dateNote.style.display='block';
      dateNote.innerHTML = `📅 Stats reflect <strong>${isToday ? "today ("+statDate+")" : statDate}</strong>. Change the date filter below to view other days.`;
    } else {
      dateNote.style.display='none';
    }
  }
  const sc={'ON TIME':'stt-on-time','LATE':'stt-late','ABSENT':'stt-absent','OVERTIME':'stt-overtime'};
  const isAdminView = currentUser.access === 'Full Access';
  // Action column always visible
  const actionTh = document.getElementById('att-action-th');
  if(actionTh) actionTh.style.display = '';
  // Render pending edit requests for admin
  if(isAdminView){
    renderEditRequests();
  }
  document.getElementById('att-body').innerHTML=rows.length===0
    ?'<tr><td colspan="9" style="text-align:center;padding:22px;color:var(--text-light)">No records found.</td></tr>'
    :rows.map(r=>{
      const pendingReq = editRequests.find(q=>q.attId===r.id && q.status==='Pending');
      const approvedReq = editRequests.find(q=>q.attId===r.id && q.status==='Approved');
      const rejectedReq = editRequests.find(q=>q.attId===r.id && q.status==='Rejected');
      const rowClass = pendingReq ? 'class="req-row"' : '';
      let actionCell = '';
      if(isAdminView){
        // Show the most recent resolved request status for admin
        if(approvedReq){
          actionCell = `<td>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#e3f7e3;color:#1b6b1e;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">✅ Approved Request</span>
              <span style="font-size:10px;color:var(--text-light);padding-left:2px">by ${approvedReq.empName}</span>
            </div>
          </td>`;
        } else if(rejectedReq){
          actionCell = `<td>
            <div style="display:flex;flex-direction:column;gap:2px">
              <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#fce4ec;color:#c62828;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap">❌ Request Not Approved</span>
              <span style="font-size:10px;color:var(--text-light);padding-left:2px">by ${rejectedReq.empName}</span>
            </div>
          </td>`;
        } else if(pendingReq){
          actionCell = `<td>
            <div style="display:flex;flex-direction:column;gap:5px">
              <span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#fff3e0;color:#c95500;border-radius:20px;font-size:11px;font-weight:700">⏳ Pending</span>
              <div style="display:flex;gap:4px">
                <button onclick="approveEditRequest(${pendingReq.id})" style="padding:3px 9px;background:var(--green-mid);color:white;border:none;border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✓</button>
                <button onclick="rejectEditRequest(${pendingReq.id})" style="padding:3px 9px;background:rgba(181,48,31,0.1);color:var(--red);border:1px solid rgba(181,48,31,0.25);border-radius:6px;font-size:11px;font-weight:700;cursor:pointer">✕</button>
              </div>
            </div>
          </td>`;
        } else {
          actionCell = `<td style="font-size:12px;color:var(--text-light)">—</td>`;
        }
      } else {
        // Employee: only show request actions for their OWN records
        const myPending  = editRequests.find(q=>q.attId===r.id && q.status==='Pending'  && q.empId===currentUser.empId);
        const myApproved = editRequests.find(q=>q.attId===r.id && q.status==='Approved' && q.empId===currentUser.empId);
        const myRejected = editRequests.find(q=>q.attId===r.id && q.status==='Rejected' && q.empId===currentUser.empId);
        if(myPending){
          actionCell = `<td><span class="req-pending-lbl">⏳ Pending</span></td>`;
        } else if(myApproved){
          actionCell = `<td><span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#e3f7e3;color:#1b6b1e;border-radius:20px;font-size:11px;font-weight:700">✅ Approved</span></td>`;
        } else if(myRejected){
          actionCell = `<td><button onclick="openEditRequest(${r.id})" style="padding:4px 11px;background:var(--orange);color:white;border:none;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif">✏ Re-Edit</button></td>`;
        } else {
          actionCell = `<td><button onclick="openEditRequest(${r.id})" style="padding:4px 11px;background:var(--orange);color:white;border:none;border-radius:20px;font-size:11px;font-weight:700;cursor:pointer;font-family:'DM Sans',sans-serif">✏ Edit</button></td>`;
        }
      }
      return `<tr ${rowClass}>
        <td style="color:var(--text-light)">${r.empId}</td>
        <td><strong>${r.name}</strong></td>
        <td>${r.date}</td><td>${r.timeIn}</td><td>${r.timeOut}</td><td>${r.hours} hrs</td>
        <td><span class="${sc[r.status]||''}">${r.status}</span></td>
        <td style="font-size:12px" class="${isAdminView?'note-cell':''}" ${isAdminView?`onclick="startNoteEdit(this,${r.id})"`:''}>
          ${r.notes
            ? `<span style="color:#1565c0;font-weight:600">📋 ${r.notes}</span>${isAdminView?'<span class="note-edit-hint">✏</span>':''}`
            : isAdminView
              ? '<span style="color:var(--text-light)">— <span class="note-edit-hint">✏</span></span>'
              : '<span style="color:var(--text-light)">—</span>'
          }
        </td>
        ${actionCell}
      </tr>`;}).join('');
}

// ══════════════════════════════════════════════
// INLINE NOTE EDITING (Admin only)
// ══════════════════════════════════════════════
function startNoteEdit(cell, recordId){
  const record = attData.find(r => r.id === recordId);
  if(!record) return;
  const currentNote = record.notes || '';
  cell.innerHTML = `<input class="note-inline-input" id="note-inp-${recordId}" type="text" value="${currentNote.replace(/"/g,'&quot;')}" placeholder="Add a note..." maxlength="120">`;
  const inp = document.getElementById('note-inp-'+recordId);
  inp.focus();
  inp.select();
  inp.addEventListener('keydown', e => {
    if(e.key === 'Enter'){ e.preventDefault(); saveNoteEdit(recordId, inp.value, cell); }
    if(e.key === 'Escape'){ renderAtt(); }
  });
  inp.addEventListener('blur', () => saveNoteEdit(recordId, inp.value, cell));
}
function saveNoteEdit(recordId, newNote, cell){
  const record = attData.find(r => r.id === recordId);
  if(!record) return;
  const trimmed = newNote.trim();
  if(trimmed === record.notes) { renderAtt(); return; }
  record.notes = trimmed;
  // Save to Hasura
  gql(`mutation($id:Int!,$n:String!){update_attendance_by_pk(pk_columns:{id:$id},_set:{notes:$n}){id}}`,
    {id: recordId, n: trimmed});
  renderAtt();
  toast('📋 Note saved!');
}

// ══════════════════════════════════════════════
// ATTENDANCE EDIT REQUESTS
// ══════════════════════════════════════════════
function openEditRequest(attId){
  const record = attData.find(r=>r.id===attId);
  if(!record){toast('Record not found');return;}
  const box = document.getElementById('modal-box');
  document.getElementById('modal-overlay').classList.add('open');
  // Convert 12h to 24h for input
  const to24 = str => {
    if(!str||str==='--:--') return '';
    const [time,ap] = str.split(' ');
    let [h,m] = time.split(':').map(Number);
    if(ap==='PM'&&h!==12) h+=12;
    if(ap==='AM'&&h===12) h=0;
    return h.toString().padStart(2,'0')+':'+m.toString().padStart(2,'0');
  };
  box.innerHTML=`<button class="modal-close" onclick="closeModal()">✕</button>
    <div class="modal-title">Request Log Edit</div>
    <div style="background:#fff8f0;border:1px solid var(--orange);border-radius:10px;padding:12px 15px;margin-bottom:18px;font-size:13px">
      <div style="font-weight:700;color:var(--orange);margin-bottom:4px">📅 Current Record — ${record.date}</div>
      <div style="color:var(--text-mid)">Time In: <strong>${record.timeIn}</strong> &nbsp;·&nbsp; Time Out: <strong>${record.timeOut}</strong> &nbsp;·&nbsp; Status: <strong>${record.status}</strong></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="fg"><label class="fl">✏ Correct Time In</label><input class="fi" id="req-ti" type="time" value="${to24(record.timeIn)}"></div>
      <div class="fg"><label class="fl">✏ Correct Time Out</label><input class="fi" id="req-to" type="time" value="${to24(record.timeOut)}"></div>
    </div>
    <div class="fg"><label class="fl">Reason for Change <span style="color:var(--red)">*</span></label>
      <select class="fs" id="req-reason-type" onchange="toggleOtherReason()">
        <option value="">— Select a reason —</option>
        <option>Forgot to clock in</option>
        <option>Forgot to clock out</option>
        <option>System error / glitch</option>
        <option>Wrong time entered</option>
        <option>Was working off-site</option>
        <option>Other</option>
      </select>
    </div>
    <div class="fg" id="req-other-fg" style="display:none"><label class="fl">Describe the reason <span style="color:var(--red)">*</span></label><textarea class="fi" id="req-reason-other" placeholder="Describe the reason in detail..." rows="3" style="resize:vertical;min-height:70px"></textarea></div>
    <div class="modal-actions">
      <button class="btn-cancel" onclick="closeModal()">Cancel</button>
      <button class="btn-save" onclick="submitEditRequest(${attId})" style="background:linear-gradient(135deg,var(--orange),var(--orange-light))">📤 Send for Approval</button>
    </div>`;
}
function toggleOtherReason(){
  const val = document.getElementById('req-reason-type').value;
  document.getElementById('req-other-fg').style.display = val==='Other' ? 'block' : 'none';
}
async function submitEditRequest(attId){
  const tiVal = document.getElementById('req-ti').value;
  const toVal = document.getElementById('req-to').value;
  const reasonType = document.getElementById('req-reason-type').value;
  const reasonOther = document.getElementById('req-reason-other') ? document.getElementById('req-reason-other').value.trim() : '';
  if(!reasonType){toast('Please select a reason');return;}
  if(reasonType==='Other'&&!reasonOther){toast('Please describe the reason');return;}
  const reason = reasonType==='Other' ? reasonOther : reasonType;
  const fmt = t => { if(!t) return '--:--'; const [h,m]=t.split(':').map(Number); const ap=h>=12?'PM':'AM'; const hh=((h%12)||12).toString().padStart(2,'0'); return `${hh}:${m.toString().padStart(2,'0')} ${ap}`; };
  const record = attData.find(r=>r.id===attId);
  const req = {
    id: null, // will be set after Hasura responds with real DB id
    attId, empId: currentUser.empId, empName: currentUser.name,
    date: record ? record.date : '',
    origTimeIn: record ? record.timeIn : '',
    origTimeOut: record ? record.timeOut : '',
    reqTimeIn: fmt(tiVal), reqTimeOut: fmt(toVal),
    reason, status: 'Pending',
    submittedAt: new Date().toLocaleString('en-PH')
  };
  // Push to Hasura and capture the real DB-assigned ID
  const res = await nhostInsertEditReq({
    att_id: attId, emp_id: currentUser.empId, emp_name: currentUser.name,
    date: req.date, orig_time_in: req.origTimeIn, orig_time_out: req.origTimeOut,
    req_time_in: req.reqTimeIn, req_time_out: req.reqTimeOut,
    reason, status: 'Pending', submitted_at: new Date().toISOString()
  });
  console.log('[EditReq] insert result:', res);
  if(res && res.insert_attendance_edit_requests_one){
    req.id = res.insert_attendance_edit_requests_one.id;
  } else {
    // fallback local id if Hasura fails
    req.id = editRequests.length > 0 ? Math.max(...editRequests.filter(r=>r.id).map(r=>r.id))+1 : 1;
    toast('⚠️ Saved locally but Hasura sync may have failed');
  }
  editRequests.push(req);
  closeModal();
  renderAtt();
  if(currentUser.access==='Full Access') renderEditRequests();
  toast('✅ Edit request submitted — pending admin approval');
}
function switchAttTab(tab){
  const isLogs=tab==='logs';
  document.getElementById('att-logs-panel').style.display=isLogs?'block':'none';
  document.getElementById('att-requests-panel').style.display=isLogs?'none':'block';
  document.getElementById('att-tab-logs').style.background=isLogs?'var(--green-mid)':'transparent';
  document.getElementById('att-tab-logs').style.color=isLogs?'white':'var(--text-mid)';
  document.getElementById('att-tab-requests').style.background=isLogs?'transparent':'var(--orange)';
  document.getElementById('att-tab-requests').style.color=isLogs?'var(--text-mid)':'white';
}
function renderEditRequests(){
  const isAdmin = currentUser.access === 'Full Access';
  // Show tab switcher for admin
  const switcher=document.getElementById('att-tab-switcher');
  if(switcher) switcher.style.display=isAdmin?'flex':'none';
  if(!isAdmin){ document.getElementById('att-requests-panel').style.display='none'; return; }

  const section = document.getElementById('att-requests-section');
  const list = document.getElementById('att-requests-list');
  const pending = editRequests.filter(r=>r.status==='Pending');
  const badge = document.getElementById('att-req-count');
  const badge2 = document.getElementById('att-req-badge2');
  const panelList = document.getElementById('att-requests-panel-list');
  const panelCount = document.getElementById('att-req-panel-count');

  // Update badge on tab button
  if(badge2){
    badge2.style.display=pending.length?'inline':'none';
    badge2.textContent=pending.length;
  }

  if(!isAdmin){
    if(section) section.style.display='none';
    return;
  }

  // Old inline section — hide it, we use the full panel now
  if(section) section.style.display='none';
  if(badge) badge.textContent = pending.length;
  if(panelCount) panelCount.textContent = pending.length ? `${pending.length} pending` : 'No pending requests';

  const cardHtml = pending.length ? pending.map(req=>`
    <div style="background:white;border-radius:13px;padding:16px 20px;margin-bottom:12px;border:1px solid rgba(217,101,10,0.18);box-shadow:0 2px 10px rgba(30,61,15,0.07)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
        <div style="flex:1">
          <div style="font-weight:700;font-size:14px;color:var(--text-dark);margin-bottom:2px">
            ${req.empName} <span style="font-size:12px;font-weight:400;color:var(--text-light)">· ${req.date}</span>
          </div>
          <div style="font-size:12px;color:var(--text-mid);margin:6px 0;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="background:#f5f5f5;padding:3px 10px;border-radius:6px;text-decoration:line-through;color:#aaa">${req.origTimeIn} → ${req.origTimeOut}</span>
            <span style="color:var(--text-light)">→</span>
            <span style="background:rgba(58,107,24,0.08);padding:3px 10px;border-radius:6px;color:var(--green-mid);font-weight:700">${req.reqTimeIn} → ${req.reqTimeOut}</span>
          </div>
          <div style="font-size:12px;color:var(--orange);margin-top:4px">💬 Reason: <strong>${req.reason}</strong></div>
          <div style="font-size:11px;color:var(--text-light);margin-top:3px">Submitted: ${req.submittedAt}</div>
        </div>
        <div style="display:flex;flex-direction:column;gap:6px;min-width:100px">
          <button class="req-approve-btn" onclick="approveEditRequest(${req.id})" style="padding:8px 16px;background:var(--green-mid);color:white;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">✓ Approve</button>
          <button class="req-reject-btn" onclick="rejectEditRequest(${req.id})" style="padding:8px 16px;background:rgba(181,48,31,0.1);color:var(--red);border:1px solid rgba(181,48,31,0.25);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer">✕ Reject</button>
        </div>
      </div>
    </div>`).join('') :
    `<div style="text-align:center;padding:30px 20px;color:var(--text-light)">
      <div style="font-size:32px;margin-bottom:10px">✅</div>
      <div style="font-size:14px;font-weight:600">No pending requests</div>
      <div style="font-size:12px;margin-top:4px">All employee log edit requests have been reviewed.</div>
    </div>`;

  // Build recent history (Approved + Rejected), most recent first, max 20
  const resolved = editRequests.filter(r=>r.status==='Approved'||r.status==='Rejected').slice(0,20);
  const historyHtml = resolved.length ? `
    <div style="margin-top:22px">
      <div style="font-size:13px;font-weight:700;color:var(--text-mid);margin-bottom:10px;display:flex;align-items:center;gap:6px">
        📋 Recent Log History <span style="font-size:11px;font-weight:400;color:var(--text-light)">(last ${resolved.length})</span>
      </div>
      ${resolved.map(req=>{
        const isApproved = req.status === 'Approved';
        return `<div style="background:white;border-radius:11px;padding:13px 16px;margin-bottom:8px;border:1px solid ${isApproved?'rgba(27,107,30,0.18)':'rgba(181,48,31,0.15)'};opacity:0.92">
          <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div style="flex:1">
              <div style="font-weight:600;font-size:13px;color:var(--text-dark);margin-bottom:3px">
                ${req.empName} <span style="font-size:11px;font-weight:400;color:var(--text-light)">· ${req.date}</span>
              </div>
              <div style="font-size:11px;color:var(--text-mid);display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:3px">
                <span style="text-decoration:line-through;color:#bbb">${req.origTimeIn} → ${req.origTimeOut}</span>
                <span>→</span>
                <span style="font-weight:700;color:${isApproved?'var(--green-mid)':'var(--text-mid)'}">${req.reqTimeIn} → ${req.reqTimeOut}</span>
              </div>
              <div style="font-size:11px;color:var(--text-light)">Reason: ${req.reason} · ${req.submittedAt}</div>
            </div>
            <span style="padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700;white-space:nowrap;${isApproved?'background:#e3f7e3;color:#1b6b1e':'background:#fce4ec;color:#c62828'}">
              ${isApproved?'✅ Approved Request':'❌ Request Not Approved'}
            </span>
          </div>
        </div>`;
      }).join('')}
    </div>` : '';

  if(panelList) panelList.innerHTML = cardHtml + historyHtml;
}
async function approveEditRequest(reqId){
  const req = editRequests.find(r=>r.id===reqId);
  if(!req){toast('❌ Request not found (id='+reqId+')');return;}
  const record = attData.find(r=>r.id===req.attId);
  if(!record){toast('❌ Attendance record not found (attId='+req.attId+')');return;}

  const parseTime12 = str => {
    if(!str||str==='--:--') return null;
    const [time,ap] = str.split(' ');
    let [h,m] = time.split(':').map(Number);
    if(ap==='PM'&&h!==12) h+=12;
    if(ap==='AM'&&h===12) h=0;
    const d=new Date(); d.setHours(h,m,0,0); return d;
  };
  const tiDate = parseTime12(req.reqTimeIn);
  const toDate = parseTime12(req.reqTimeOut);
  const hrsNum = (tiDate&&toDate) ? parseFloat(((toDate-tiDate)/3600000).toFixed(2)) : null;
  const hrsStr = hrsNum !== null ? String(hrsNum) : String(record.hours);
  const status = (tiDate&&toDate) ? calcStatus(tiDate,toDate) : record.status;

  // STEP 1: Update attendance — use String for hours to match DB column type
  const attRes = await gql(
    `mutation($aid:Int!,$ti:String!,$to:String!,$hrs:String!,$st:String!){
       update_attendance_by_pk(pk_columns:{id:$aid},_set:{time_in:$ti,time_out:$to,hours:$hrs,status:$st}){id}
     }`,
    {aid: parseInt(req.attId), ti: req.reqTimeIn, to: req.reqTimeOut, hrs: hrsStr, st: status}
  );
  if(!attRes){ toast('❌ Attendance update failed — check console'); return; }

  // STEP 2: Mark edit request as Approved
  await gql(
    `mutation($rid:Int!){update_attendance_edit_requests_by_pk(pk_columns:{id:$rid},_set:{status:"Approved"}){id}}`,
    {rid: parseInt(req.id)}
  );

  // STEP 3: Update local state
  record.timeIn = req.reqTimeIn;
  record.timeOut = req.reqTimeOut;
  record.hours = hrsStr;
  record.status = status;
  req.status = 'Approved';

  renderAtt(); renderEditRequests(); syncTcState();
  toast('✅ Approved! ' + req.reqTimeIn + ' → ' + req.reqTimeOut);
}

async function rejectEditRequest(reqId){
  const req = editRequests.find(r=>r.id===reqId);
  if(!req){ toast('❌ Request not found'); return; }
  const res = await gql(
    `mutation($rid:Int!){update_attendance_edit_requests_by_pk(pk_columns:{id:$rid},_set:{status:"Rejected"}){id}}`,
    {rid: parseInt(req.id)}
  );
  if(!res){ toast('❌ Reject failed — check console'); return; }
  req.status = 'Rejected';
  renderAtt(); renderEditRequests();
  toast('🚫 Edit request rejected.');
}




// ══════════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════════
function openModal(type){
  const box=document.getElementById('modal-box');
  document.getElementById('modal-overlay').classList.add('open');
  const empOpts=Object.values(DB_USERS).map(u=>`<option value="${u.empId}">${u.name} (${u.role})</option>`).join('');
  if(type==='inv-add'){
    const _catItems=(INV_ITEMS_BY_CAT[activeInvCat]||[]).map(i=>`<option value="${i.name}" data-unit="${i.unit}">${i.name}</option>`).join('');
    const _suppOpts=SUPPLIERS.map(s=>`<option value="${s}">${s}</option>`).join('');
    box.innerHTML=`<button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-title">Add Inventory Item</div>
      <div class="fg"><label class="fl">Item Name</label>
        <div style="display:flex;gap:6px;align-items:center">
          <select class="fs" id="ni-name-sel" onchange="syncInvUnit();document.getElementById('ni-name').value=this.value" style="flex:1"><option value="">— Pick existing —</option>${_catItems}</select>
          <span style="font-size:11px;color:var(--text-light);white-space:nowrap">or type:</span>
        </div>
        <input class="fi" id="ni-name" placeholder="Type item name manually..." style="margin-top:6px">
      </div>
      <div class="fg"><label class="fl">Unit</label>
        <select class="fs" id="ni-unit"><option>Grams (g)</option><option>Kilograms (kg)</option><option>Liters (L)</option><option>Pieces (pcs)</option><option>ml</option></select></div>
      <div class="fg"><label class="fl">Current Stock</label><input class="fi" id="ni-stock" type="number" placeholder="0"></div>
      <div class="fg"><label class="fl">Low Stock Threshold</label><input class="fi" id="ni-threshold" type="number" placeholder="0"></div>
      <div class="fg"><label class="fl">Supplier</label>
        <div style="display:flex;gap:6px;align-items:center">
          <select class="fs" id="ni-supplier-sel" onchange="document.getElementById('ni-supplier').value=this.value" style="flex:1"><option value="">— Pick supplier —</option>${_suppOpts}</select>
          <span style="font-size:11px;color:var(--text-light);white-space:nowrap">or type:</span>
        </div>
        <input class="fi" id="ni-supplier" placeholder="Type supplier name manually..." style="margin-top:6px">
      </div>
      <div class="fg"><label class="fl">Notes</label><input class="fi" id="ni-notes" placeholder="Optional"></div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-save" onclick="addInvItem()">Add Item</button>
      </div>`;
  }else if(type==='inv-edit'){
    const chk=[...document.querySelectorAll('.inv-chk:checked')];
    if(chk.length!==1){closeModal();toast('Select exactly 1 item to edit');return;}
    const id=chk[0].dataset.id;
    const item=Object.values(invData).flat().find(i=>i.id===id);
    box.innerHTML=`<button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-title">Edit: ${item.name}</div>
      <div class="fg"><label class="fl">Item Name</label><input class="fi" id="ei-name" value="${item.name}"></div>
      <div class="fg"><label class="fl">Unit</label>
        <select class="fs" id="ei-unit">${['Grams (g)','Kilograms (kg)','Liters (L)','Pieces (pcs)'].map(u=>`<option ${u===item.unit?'selected':''}>${u}</option>`).join('')}</select></div>
      <div class="fg"><label class="fl">Current Stock</label><input class="fi" id="ei-stock" type="number" value="${item.stock}"></div>
      <div class="fg"><label class="fl">Threshold</label><input class="fi" id="ei-threshold" type="number" value="${item.threshold}"></div>
      <div class="fg"><label class="fl">Supplier</label><div class="fi" style="background:#f5f5f5;color:var(--text-mid);cursor:default;padding:11px 14px;border-radius:var(--radius-sm);font-size:14px;border:1.5px solid var(--green-pale)">${item.supplier||'—'}</div><input type="hidden" id="ei-supplier" value="${item.supplier||''}"></div>
      <div class="fg"><label class="fl">Notes</label><input class="fi" id="ei-notes" value="${item.notes||''}"></div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-save" onclick="saveInvEdit('${id}')">Save Changes</button>
      </div>`;
  }else if(type==='att-add'){
    box.innerHTML=`<button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-title">Add Attendance Record</div>
      <div class="fg"><label class="fl">Employee</label><select class="fs" id="na-emp">${empOpts}</select></div>
      <div class="fg"><label class="fl">Date</label><input class="fi" id="na-date" type="date" value="${new Date().toISOString().split('T')[0]}"></div>
      <div class="fg"><label class="fl">Time In</label><input class="fi" id="na-in" type="time" value="08:00"></div>
      <div class="fg"><label class="fl">Time Out</label><input class="fi" id="na-out" type="time" value="17:00"></div>
      <div class="fg"><label class="fl">Status</label>
        <select class="fs" id="na-status"><option>ON TIME</option><option>LATE</option><option>ABSENT</option><option>OVERTIME</option></select></div>
      <div class="fg"><label class="fl">Notes</label><input class="fi" id="na-notes" placeholder="Optional"></div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-save" onclick="addAttRecord()">Add Record</button>
      </div>`;
  }else if(type==='order'){
    // Build menu options grouped by category
    const menuOpts = Object.entries(MENU).map(([cat,items])=>
      `<optgroup label="── ${cat} ──">${items.map(i=>
        i.sizes.length
          ? i.sizes.map(s=>{const lbl=s==='R'?'Regular':s==='M'?'Medium':'Large';const p=i.price+((i.adj&&i.adj[s])||0);return`<option value="1x ${i.name} (${lbl})|${p}">1x ${i.name} (${lbl}) — ₱${p}</option>`;}).join('')
          : `<option value="1x ${i.name}|${i.price}">1x ${i.name} — ₱${i.price}</option>`
      ).join('')}</optgroup>`
    ).join('');
    box.innerHTML=`<button class="modal-close" onclick="closeModal()">✕</button>
      <div class="modal-title">Add Order</div>
      <div class="fg"><label class="fl">Customer Name</label><input class="fi" id="no-cust" placeholder="Walk-in"></div>
      <div class="fg"><label class="fl">Item(s) <span style="font-size:11px;color:var(--text-light);font-weight:400">(hold Ctrl/Cmd to select multiple)</span></label>
        <select class="fs" id="no-item-sel" multiple size="7" style="height:auto;min-height:130px" onchange="calcOrderTotal()">${menuOpts}</select>
      </div>
      <div class="fg"><label class="fl">Amount (₱)</label><input class="fi" id="no-amt" type="number" placeholder="0" style="background:#f5f5f5"></div>
      <div class="modal-actions">
        <button class="btn-cancel" onclick="closeModal()">Cancel</button>
        <button class="btn-save" onclick="addOrderManual()">Add Order</button>
      </div>`;
  }
}
function closeModal(){document.getElementById('modal-overlay').classList.remove('open');}
function closeModalOv(e){if(e.target===document.getElementById('modal-overlay'))closeModal();}

function syncInvUnit(){
  const sel=document.getElementById('ni-name-sel');
  if(!sel) return;
  const opt=sel.options[sel.selectedIndex];
  const unit=opt?opt.getAttribute('data-unit'):'';
  if(!unit) return;
  const us=document.getElementById('ni-unit');
  for(let i=0;i<us.options.length;i++){if(us.options[i].text===unit){us.selectedIndex=i;break;}}
}
function addInvItem(){
  const name=(document.getElementById('ni-name').value||'').trim();
  if(!name){toast('Enter an item name');return;}
  const allIds=Object.values(invData).flat().map(i=>parseInt(i.id.replace('INV-','')));
  const num=(Math.max(...allIds,0)+1).toString().padStart(3,'0');
  const supplierVal=(document.getElementById('ni-supplier').value||'').trim()||'—';
  const newItem={
    id:'INV-'+num,name,
    unit:document.getElementById('ni-unit').value,
    stock:parseInt(document.getElementById('ni-stock').value)||0,
    threshold:parseInt(document.getElementById('ni-threshold').value)||0,
    lastRestocked:new Date().toISOString().split('T')[0],
    supplier:supplierVal,
    notes:document.getElementById('ni-notes').value||''
  };
  invData[activeInvCat].push(newItem);
  nhostInsertInv({id:newItem.id, name:newItem.name, category:activeInvCat, unit:newItem.unit, stock:newItem.stock, threshold:newItem.threshold, supplier:newItem.supplier, last_restocked:newItem.lastRestocked, notes:newItem.notes||''})
    .then(res => {
      if(!res) toast('⚠ Item saved locally but failed to sync to database. Check your connection.');
    });
  renderInv();checkLowStock();renderInvCats();closeModal();toast(name+' added!');
}
function saveInvEdit(id){
  const item=Object.values(invData).flat().find(i=>i.id===id);
  const prevStock = item.stock;
  item.name=document.getElementById('ei-name').value;
  item.unit=document.getElementById('ei-unit').value;
  const newStock=parseInt(document.getElementById('ei-stock').value)||0;
  item.stock=newStock;
  item.threshold=parseInt(document.getElementById('ei-threshold').value)||0;
  item.supplier=document.getElementById('ei-supplier').value;
  item.notes=document.getElementById('ei-notes').value;
  nhostUpdateInv(id,{name:item.name, unit:item.unit, stock:item.stock, threshold:item.threshold, supplier:item.supplier, notes:item.notes||'', last_restocked:item.lastRestocked||new Date().toISOString().split('T')[0]});
  // Log the stock change if it changed
  if(newStock !== prevStock){
    nhostInsertInvLog({
      inventory_id: id, item_name: item.name,
      qty_deducted: prevStock - newStock, unit: item.unit,
      stock_before: prevStock, stock_after: newStock,
      reason: 'Manual adjustment', logged_by: currentUser ? currentUser.name : 'Admin',
      logged_at: new Date().toISOString()
    });
  }
  renderInv();checkLowStock();renderInvCats();closeModal();toast('Item updated!');
}
function addAttRecord(){
  const empId=document.getElementById('na-emp').value;
  const user=Object.values(DB_USERS).find(u=>u.empId===empId);
  const date=document.getElementById('na-date').value;
  const ti=document.getElementById('na-in').value;
  const to=document.getElementById('na-out').value;
  const status=document.getElementById('na-status').value;
  const notes=document.getElementById('na-notes').value;
  const fmt=t=>{const[h,m]=t.split(':');const H=parseInt(h);return`${(H%12||12).toString().padStart(2,'0')}:${m} ${H>=12?'PM':'AM'}`;};
  const [h1,m1]=ti.split(':').map(Number),[h2,m2]=to.split(':').map(Number);
  const hrs=((h2*60+m2-h1*60-m1)/60).toFixed(2);
  attData.unshift({id:attData.length+1,empId,name:user?user.name:empId,
    date,timeIn:fmt(ti),timeOut:fmt(to),hours:parseFloat(hrs)>0?hrs:'--',status,notes});
  const empName = user ? user.name : empId;
  const fmtHrs = parseFloat(hrs) > 0 ? String(hrs) : '--';
  nhostInsertAtt({emp_id:empId, name:empName, date, time_in:fmt(ti), time_out:fmt(to), hours:fmtHrs, status, notes});
  fillAttDropdown();renderAtt();closeModal();toast('Attendance record added!');
}
function calcOrderTotal(){
  const sel=document.getElementById('no-item-sel');
  if(!sel)return;
  const total=[...sel.selectedOptions].reduce((s,o)=>s+parseInt(o.value.split('|')[1]||0),0);
  document.getElementById('no-amt').value=total;
}
function addOrderManual(){
  const cust=document.getElementById('no-cust').value.trim()||'Walk-in';
  const sel=document.getElementById('no-item-sel');
  const selected=sel?[...sel.selectedOptions]:[];
  if(!selected.length){toast('Select at least one item');return;}
  const itemStr=selected.map(o=>o.value.split('|')[0]).join(', ');
  const amt=selected.reduce((s,o)=>s+parseInt(o.value.split('|')[1]||0),0)||parseInt(document.getElementById('no-amt').value)||0;
  const time=new Date().toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'});
  ordersData.unshift({id:orderCounter++,customer:cust,time,item:itemStr,amount:amt,status:'Pending'});
  nhostInsertOrder({customer:cust,item:itemStr,amount:amt,status:'Pending',time});
  renderOrders();renderMiniOrders();closeModal();toast('Order added!');
}

// ══════════════════════════════════════════════
// CSV EXPORTS
// ══════════════════════════════════════════════
function dlCSV(fn,rows){
  const csv=rows.map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const a=document.createElement('a');
  a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download=fn;a.click();URL.revokeObjectURL(a.href);toast('CSV exported!');
}
const today=()=>new Date().toISOString().split('T')[0];
function dlOrdersCSV(){
  dlCSV('AlsCafe_Orders_'+today()+'.csv',
    [['Order #','Customer','Time','Items','Amount (₱)','Status'],
     ...ordersData.map(o=>[o.id,o.customer,o.time,o.item,o.amount,o.status])]);
}
function dlInvCSV(){
  dlCSV('AlsCafe_Inventory_'+today()+'.csv',
    [['Item ID','Category','Item Name','Unit','Stock','Threshold','Status','Last Restocked','Supplier'],
     ...Object.entries(invData).flatMap(([cat,items])=>
       items.map(i=>[i.id,cat,i.name,i.unit,i.stock,i.threshold,
         i.stock<=0?'OUT':i.stock<=i.threshold?'LOW':'OK',i.lastRestocked,i.supplier]))]);
}
function dlAttCSV(){
  dlCSV('AlsCafe_Attendance_'+today()+'.csv',
    [['Emp ID','Name','Date','Time In','Time Out','Hours','Status','Notes'],
     ...attData.map(r=>[r.empId,r.name,r.date,r.timeIn,r.timeOut,r.hours,r.status,r.notes])]);
}


// ══════════════════════════════════════════════
// TOAST & KEYBOARD
// ══════════════════════════════════════════════
let toastT;
function toast(msg){
  const t=document.getElementById('toast');
  t.textContent=msg;t.classList.add('show');
  clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2800);
}

// ══════════════════════════════════════════════
// SIDEBAR TOGGLE (mobile/tablet)
// ══════════════════════════════════════════════
function toggleSidebar(){
  const sb=document.getElementById('sidebar');
  const ov=document.getElementById('sidebar-overlay');
  const isOpen=sb.classList.toggle('open');
  ov.classList.toggle('open',isOpen);
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}
// Close sidebar on nav click on mobile
document.querySelectorAll('.nav-item').forEach(el=>{
  el.addEventListener('click',()=>{
    if(window.innerWidth<1024) closeSidebar();
  });
});

// ══════════════════════════════════════════════
// TIME CLOCK (Employee self-log)
// SHIFT_START = 08:00, REGULAR_HRS = 9
// Overtime if hours > 9; Late if time-in after 08:05; Absent managed by admin
// ══════════════════════════════════════════════
const SHIFT_START_H = 8, SHIFT_START_M = 0; // 8:00 AM
const REGULAR_HRS = 9;
let tcInterval = null;

function initTimeClock(){
  const isEmployee = currentUser.access === 'Employee Access';
  document.getElementById('timeclock-section').style.display = isEmployee ? 'block' : 'none';
  if(!isEmployee) return;
  document.getElementById('tc-emp-name').textContent = currentUser.name + ' · ' + currentUser.role;
  updateTcClock();
  if(tcInterval) clearInterval(tcInterval);
  tcInterval = setInterval(updateTcClock, 1000);
  syncTcState();
}

function updateTcClock(){
  const n=new Date();
  const h=n.getHours(),m=n.getMinutes(),s=n.getSeconds();
  const ap=h>=12?'PM':'AM',hh=((h%12)||12).toString().padStart(2,'0'),mm=m.toString().padStart(2,'0'),ss=s.toString().padStart(2,'0');
  const el=document.getElementById('tc-clock');
  if(el) el.textContent=`${hh}:${mm}:${ss} ${ap}`;
  const dateLbl=document.getElementById('tc-date-lbl');
  if(dateLbl) dateLbl.textContent=n.toLocaleDateString('en-PH',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
}

function todayStr(){return new Date().toISOString().split('T')[0];}

function fmtTime(d){
  const h=d.getHours(),m=d.getMinutes();
  const ap=h>=12?'PM':'AM',hh=((h%12)||12).toString().padStart(2,'0'),mm=m.toString().padStart(2,'0');
  return `${hh}:${mm} ${ap}`;
}

function calcStatus(timeInDate, timeOutDate){
  const lateGrace = 5; // minutes grace
  const inMins = timeInDate.getHours()*60 + timeInDate.getMinutes();
  const shiftMins = SHIFT_START_H*60 + SHIFT_START_M;
  if(inMins > shiftMins + lateGrace) return 'LATE';
  if(timeOutDate){
    const hrs = (timeOutDate - timeInDate) / 3600000;
    if(hrs > REGULAR_HRS + 0.5) return 'OVERTIME';
  }
  return 'ON TIME';
}

function syncTcState(){
  const today = todayStr();
  const myRecord = attData.find(r => r.empId === currentUser.empId && r.date === today);
  const btnIn = document.getElementById('tc-btn-in');
  const btnOut = document.getElementById('tc-btn-out');
  const stamped = document.getElementById('tc-stamped');
  const statusLbl = document.getElementById('tc-today-status');
  if(!myRecord){
    btnIn.disabled = false;
    btnOut.disabled = true;
    stamped.style.display = 'none';
    statusLbl.textContent = 'No log today — tap TIME IN to start your shift';
  } else if(myRecord.timeOut === '--:--' || !myRecord.timeOut){
    btnIn.disabled = true;
    btnOut.disabled = false;
    stamped.style.display = 'block';
    stamped.innerHTML = `⏱ Clocked in at <strong>${myRecord.timeIn}</strong> — tap TIME OUT when done`;
    statusLbl.textContent = 'Shift in progress';
  } else {
    btnIn.disabled = true;
    btnOut.disabled = true;
    const sc={'ON TIME':'🟢','LATE':'🟡','ABSENT':'🔴','OVERTIME':'🟣'};
    stamped.style.display = 'block';
    stamped.innerHTML = `${sc[myRecord.status]||'⚪'} Today: <strong>${myRecord.timeIn}</strong> → <strong>${myRecord.timeOut}</strong> · ${myRecord.hours} hrs · <strong>${myRecord.status}</strong>`;
    statusLbl.textContent = 'Shift complete for today';
  }
}

async function doTimeIn(){
  const today = todayStr();
  const existing = attData.find(r => r.empId === currentUser.empId && r.date === today);
  if(existing){ toast('You already clocked in today!'); return; }
  const now = new Date();
  const timeInStr = fmtTime(now);
  const record = {
    id: null,
    empId: currentUser.empId,
    name: currentUser.name,
    date: today,
    timeIn: timeInStr,
    timeOut: '--:--',
    hours: '--',
    status: 'ON TIME',
    notes: '',
    _timeInDate: now.toISOString()
  };
  attData.unshift(record);
  // Insert to Hasura and capture the real DB-assigned ID
  const res = await gql(
    `mutation($obj:attendance_insert_input!){insert_attendance_one(object:$obj){id}}`,
    {obj:{emp_id:record.empId, name:record.name, date:record.date, time_in:record.timeIn, time_out:'--:--', hours:'--', status:'ON TIME', notes:''}}
  );
  if(res && res.insert_attendance_one) {
    record.id = res.insert_attendance_one.id;
  } else {
    record.id = attData.filter(r=>r.id).length > 0 ? Math.max(...attData.filter(r=>r.id).map(r=>r.id)) + 1 : 1;
  }
  renderAtt(); fillAttDropdown(); syncTcState();
  toast('✅ Time In recorded: ' + timeInStr);
}

async function doTimeOut(){
  const today = todayStr();
  const record = attData.find(r => r.empId === currentUser.empId && r.date === today);
  if(!record){ toast('No time-in found for today!'); return; }
  if(record.timeOut !== '--:--' && record.timeOut){ toast('Already clocked out!'); return; }
  const now = new Date();
  const timeOutStr = fmtTime(now);
  // Parse time in for calculation
  const parseTime = (str) => {
    if(!str || str==='--:--') return null;
    const [time,ap] = str.split(' ');
    let [h,m] = time.split(':').map(Number);
    if(ap==='PM' && h!==12) h+=12;
    if(ap==='AM' && h===12) h=0;
    const d=new Date(); d.setHours(h,m,0,0); return d;
  };
  const timeInDate = parseTime(record.timeIn);
  const hrsNum = timeInDate ? parseFloat(((now - timeInDate)/3600000).toFixed(2)) : null;
  const hrs = hrsNum !== null ? String(hrsNum) : '--';
  const status = timeInDate ? calcStatus(timeInDate, now) : 'ON TIME';
  record.timeOut = timeOutStr;
  record.hours = hrs;
  record.status = status;
  // Update in Hasura — hours is stored as String/text in DB
  await gql(
    `mutation($id:Int!,$to:String!,$hrs:String!,$st:String!){update_attendance_by_pk(pk_columns:{id:$id},_set:{time_out:$to,hours:$hrs,status:$st}){id}}`,
    {id:record.id, to:timeOutStr, hrs:hrs, st:status}
  );
  renderAtt(); fillAttDropdown(); syncTcState();
  toast('✅ Time Out recorded: ' + timeOutStr + ' · ' + hrs + ' hrs · ' + status);
}

document.addEventListener('keydown',e=>{
  if(e.key==='Escape')closeModal();
  if(e.key==='Enter'&&document.getElementById('login-page').style.display!=='none')doLogin();
});
